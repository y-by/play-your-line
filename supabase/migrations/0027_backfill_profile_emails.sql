-- 0027 — one-time backfill: profiles.email only started being saved at
-- sign-in after 0019, and until 0025 that save was failing, so people who
-- signed up earlier (including people already in projects) had no email on
-- their profile and "assign by email" said "No account yet" for them.
-- Copies each existing user's email from the sign-in system (auth.users).
-- Only fills blanks; never overwrites. New sign-ins keep it filled (0025).
--
-- Run from the Supabase SQL editor (it can read auth.users).
-- Safe to run more than once.

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is null
  and u.email is not null;
