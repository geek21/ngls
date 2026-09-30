-- migration_v6_subsubject_days.sql
-- Adds days_per_week to sub_subjects so each branch (e.g. AL, OL) can have
-- its own independent schedule independent of the parent department.
--
-- Run this ONCE on an existing project.
-- New projects: already included if you re-run schema.sql after this patch.

alter table sub_subjects
  add column if not exists days_per_week int not null default 5;

comment on column sub_subjects.days_per_week is
  'Number of teaching days per week for this branch. Overrides parent department value.';
