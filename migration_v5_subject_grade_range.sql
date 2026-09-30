-- =====================================================================
-- Migration v5 — Grade range per sub-subject (branch)
-- Run this ONCE in SQL Editor if your database was created before this
-- feature existed. Safe to run multiple times (idempotent).
-- Existing branches get NULL/NULL (meaning: applies to ALL grades),
-- so nothing changes for them until you edit a range in.
-- =====================================================================

alter table sub_subjects add column if not exists grade_from int;
alter table sub_subjects add column if not exists grade_to int;
