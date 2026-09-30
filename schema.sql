-- =====================================================================
-- School Weekly Plan System — Supabase Schema + Seed Data  (v3 — security-hardened)
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query
--
-- If your project already ran an OLDER version of this file, do NOT just
-- re-run this one blindly — use migration_v3_security.sql instead, which
-- safely upgrades an existing database without losing data. This full
-- file is for BRAND NEW projects only.
-- =====================================================================

create extension if not exists pgcrypto; -- for crypt()/gen_salt() PIN hashing

-- ---------- 1. school_settings ----------
-- NOTE: admin_pin is intentionally NOT stored here anymore (see admin_secrets below).
create table if not exists school_settings (
  setting_key   text primary key,
  setting_value text not null
);

-- ---------- 2. departments (subjects) ----------
create table if not exists departments (
  id               bigint generated always as identity primary key,
  department_code  text unique not null,      -- e.g. 'MATH'
  department_name  text not null,             -- e.g. 'Math'
  pin_code         text not null,             -- bcrypt HASH of the 4-digit teacher PIN (never plaintext)
  theme_color      text not null,             -- hex color, e.g. '#7c3aed'
  days_per_week    int  not null default 5,   -- 1-5
  sort_order       int  not null default 0,
  head_name        text,                      -- department head's name (optional)
  specialization   text,                      -- department head's specialization (optional)
  whatsapp_number  text                       -- department head's WhatsApp number, international format e.g. 9665xxxxxxxx (optional)
);

-- ---------- 3. sub_subjects (branches) ----------
create table if not exists sub_subjects (
  id             bigint generated always as identity primary key,
  department_id  bigint not null references departments(id) on delete cascade,
  name           text not null,
  days_per_week  int not null default 5,  -- independent schedule per branch (e.g. AL=3, OL=2)
  grade_from     int,   -- optional: lowest grade this branch applies to (NULL = no lower limit)
  grade_to       int    -- optional: highest grade this branch applies to (NULL = no upper limit)
);

-- ---------- 4. weekly_plans ----------
create table if not exists weekly_plans (
  id              bigint generated always as identity primary key,
  academic_year   text not null,              -- e.g. '2026-2027'
  term            int  not null,              -- 1, 2, 3
  week_number     int  not null,              -- 1..40
  department_id   bigint not null references departments(id) on delete cascade,
  sub_subject_id  bigint references sub_subjects(id) on delete cascade,
  grade_level     int  not null,              -- 1..total_grades
  day_code        text not null,              -- 'D1'..'D5' (generic "Day One".."Day Five")
  classwork       text default '',
  homework        text default '',
  items_required  text default '',
  tests_quizzes   text default '',
  updated_at      timestamptz not null default now(),
  unique (academic_year, term, week_number, department_id, sub_subject_id, grade_level, day_code)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_weekly_plans_updated_at on weekly_plans;
create trigger trg_weekly_plans_updated_at
before update on weekly_plans
for each row execute function set_updated_at();

-- ---------- 5. access_links (smart weekly links for department heads) ----------
create table if not exists access_links (
  id             bigint generated always as identity primary key,
  token          text unique not null,
  department_id  bigint not null references departments(id) on delete cascade,
  academic_year  text not null,
  term           int  not null,
  week_number    int  not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days'),
  unique (department_id, academic_year, term, week_number)
);

-- ---------- 6. admin_secrets (single row, holds the hashed Admin PIN) ----------
-- RLS is enabled with ZERO policies below -> completely unreachable by the
-- anon key. Only SECURITY DEFINER functions (which run as the table owner,
-- bypassing RLS) can ever read or write it.
create table if not exists admin_secrets (
  id        int primary key default 1,
  admin_pin text not null,
  constraint admin_secrets_single_row check (id = 1)
);

insert into admin_secrets (id, admin_pin)
values (1, crypt('9999', gen_salt('bf')))
on conflict (id) do nothing;

-- ---------- 7. pin_attempts (throttling brute-force PIN guessing) ----------
create table if not exists pin_attempts (
  id           bigint generated always as identity primary key,
  attempt_key  text not null,            -- 'admin' or 'dept:<id>'
  attempted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table school_settings enable row level security;
alter table departments      enable row level security;
alter table sub_subjects     enable row level security;
alter table weekly_plans     enable row level security;
alter table access_links     enable row level security;
alter table admin_secrets    enable row level security;   -- no policies -> locked
alter table pin_attempts     enable row level security;   -- no policies -> locked

drop policy if exists "anon_all_school_settings" on school_settings;
create policy "anon_all_school_settings" on school_settings for all using (true) with check (true);

drop policy if exists "anon_all_departments" on departments;
create policy "anon_all_departments" on departments for all using (true) with check (true);

drop policy if exists "anon_all_sub_subjects" on sub_subjects;
create policy "anon_all_sub_subjects" on sub_subjects for all using (true) with check (true);

drop policy if exists "anon_all_weekly_plans" on weekly_plans;
create policy "anon_all_weekly_plans" on weekly_plans for all using (true) with check (true);

drop policy if exists "anon_all_access_links" on access_links;
create policy "anon_all_access_links" on access_links for all using (true) with check (true);

-- Column-level lockdown: even though the row policy above allows full
-- access to `departments`, nobody (anon or authenticated) may directly
-- read/write the pin_code column itself. Only the SECURITY DEFINER
-- functions below (owned by the table owner) can touch it.
revoke select (pin_code) on departments from anon, authenticated;
revoke insert (pin_code) on departments from anon, authenticated;
revoke update (pin_code) on departments from anon, authenticated;

-- ---------------------------------------------------------------------
-- Security-definer functions — the ONLY way PINs are ever checked or set
-- ---------------------------------------------------------------------

-- Records an attempt and returns false if the caller has exceeded the
-- allowed number of tries within the time window (simple brute-force throttle).
create or replace function check_and_record_attempt(
  p_key text,
  p_max_attempts int default 5,
  p_window_minutes int default 2
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_count int;
begin
  delete from pin_attempts where attempted_at < now() - (p_window_minutes || ' minutes')::interval;
  select count(*) into v_count from pin_attempts
    where attempt_key = p_key and attempted_at > now() - (p_window_minutes || ' minutes')::interval;
  if v_count >= p_max_attempts then
    return false;
  end if;
  insert into pin_attempts (attempt_key) values (p_key);
  return true;
end;
$$;

-- Verifies a department PIN. Returns 'ok' | 'wrong' | 'locked'.
-- This is the ONLY path that ever compares a department's PIN.
create or replace function verify_department_pin(p_department_id bigint, p_pin text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_match boolean;
begin
  if not check_and_record_attempt('dept:' || p_department_id) then
    return 'locked';
  end if;
  select (pin_code = crypt(p_pin, pin_code)) into v_match
  from departments where id = p_department_id;
  return case when coalesce(v_match, false) then 'ok' else 'wrong' end;
end;
$$;

-- Verifies the Admin PIN. Returns 'ok' | 'wrong' | 'locked'.
create or replace function verify_admin_pin(p_pin text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_match boolean;
begin
  if not check_and_record_attempt('admin') then
    return 'locked';
  end if;
  select (admin_pin = crypt(p_pin, admin_pin)) into v_match from admin_secrets where id = 1;
  return case when coalesce(v_match, false) then 'ok' else 'wrong' end;
end;
$$;

-- Admin-only: create a new department (hashes the PIN server-side).
create or replace function admin_create_department(
  p_admin_pin text,
  p_department_code text,
  p_department_name text,
  p_pin text,
  p_theme_color text,
  p_days_per_week int,
  p_sort_order int default 999
) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_new_id bigint;
begin
  if verify_admin_pin(p_admin_pin) <> 'ok' then
    raise exception 'unauthorized';
  end if;
  insert into departments (department_code, department_name, pin_code, theme_color, days_per_week, sort_order)
  values (p_department_code, p_department_name, crypt(p_pin, gen_salt('bf')), p_theme_color, p_days_per_week, p_sort_order)
  returning id into v_new_id;
  return v_new_id;
end;
$$;

-- Admin-only: change a department's PIN.
create or replace function admin_update_department_pin(p_admin_pin text, p_department_id bigint, p_new_pin text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if verify_admin_pin(p_admin_pin) <> 'ok' then
    return false;
  end if;
  update departments set pin_code = crypt(p_new_pin, gen_salt('bf')) where id = p_department_id;
  return true;
end;
$$;

-- Admin-only: change the Admin PIN itself (must know the current one).
create or replace function admin_update_admin_pin(p_current_pin text, p_new_pin text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if verify_admin_pin(p_current_pin) <> 'ok' then
    return false;
  end if;
  update admin_secrets set admin_pin = crypt(p_new_pin, gen_salt('bf')) where id = 1;
  return true;
end;
$$;

grant execute on function check_and_record_attempt(text, int, int)      to anon, authenticated;
grant execute on function verify_department_pin(bigint, text)           to anon, authenticated;
grant execute on function verify_admin_pin(text)                        to anon, authenticated;
grant execute on function admin_create_department(text, text, text, text, text, int, int) to anon, authenticated;
grant execute on function admin_update_department_pin(text, bigint, text) to anon, authenticated;
grant execute on function admin_update_admin_pin(text, text)            to anon, authenticated;

-- =====================================================================
-- SEED DATA
-- =====================================================================

insert into school_settings (setting_key, setting_value) values
  ('total_grades',   '10'),
  ('school_name_ar', 'اسم المدرسة'),
  ('school_name_en', 'School Name'),
  ('school_logo_url','https://placehold.co/120x120?text=Logo'),
  ('academic_year',  '2026-2027')
on conflict (setting_key) do nothing;

-- Departments (7 core subjects) — PINs are hashed at insert time.
-- Default PINs before hashing: Arabic=1001, English=1002, Math=1003,
-- Science=1004, German=1005, Social studies=1006, Religion=1007.
insert into departments (department_code, department_name, pin_code, theme_color, days_per_week, sort_order) values
  ('AR',   'Arabic',          crypt('1001', gen_salt('bf')), '#16a34a', 5, 1),
  ('EN',   'English',         crypt('1002', gen_salt('bf')), '#2563eb', 5, 2),
  ('MATH', 'Math',            crypt('1003', gen_salt('bf')), '#7c3aed', 5, 3),
  ('SCI',  'Science',         crypt('1004', gen_salt('bf')), '#ea580c', 4, 4),
  ('DE',   'German',          crypt('1005', gen_salt('bf')), '#db2777', 3, 5),
  ('SOC',  'Social studies',  crypt('1006', gen_salt('bf')), '#ca8a04', 3, 6),
  ('REL',  'Religion',        crypt('1007', gen_salt('bf')), '#0d9488', 2, 7)
on conflict (department_code) do nothing;

-- Sub-subjects for English (AL and OL each have independent days_per_week)
insert into sub_subjects (department_id, name, days_per_week)
select id, sub.name, sub.days
from departments, (values ('English AL', 5), ('English OL', 5)) as sub(name, days)
where department_code = 'EN'
  and not exists (
    select 1 from sub_subjects s where s.department_id = departments.id and s.name = sub.name
  );

-- Sub-subjects for Math
insert into sub_subjects (department_id, name)
select id, sub.name
from departments, (values ('Algebra'), ('Geometry'), ('Trigonometry'), ('Calculus')) as sub(name)
where department_code = 'MATH'
  and not exists (
    select 1 from sub_subjects s where s.department_id = departments.id and s.name = sub.name
  );
