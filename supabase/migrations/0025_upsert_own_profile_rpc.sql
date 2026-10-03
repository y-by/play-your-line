-- 0025 — fixes sign-in failing to save the profile ("permission denied for
-- table profiles", 403, seen live right after 0019).
--
-- 0019 locked profiles.email behind column privileges so it can't be read by
-- other users. But a plain client upsert (INSERT ... ON CONFLICT DO UPDATE)
-- must be allowed to READ every column it writes (EXCLUDED.email), so the
-- upsert itself started failing — silently, because the app only logged it.
-- A first sign-in therefore left no profiles row at all (very likely the real
-- cause of the foreign-key error that 0022 later worked around).
--
-- The profile is now saved through this function, which runs with its own
-- privileges and only ever touches the CALLER's row. It also holds the rule
-- "the name comes from Google only while the profile has none", so a chosen
-- stage name is never overwritten, and reports whether the row is brand new
-- (for the one-time "choose your name" prompt).
--
-- Safe to run more than once.

create or replace function upsert_own_profile(p_display_name text, p_avatar_url text, p_email text)
returns table (id uuid, display_name text, avatar_url text, is_new boolean)
language sql
security definer
set search_path = public
as $$
  insert into profiles as pr (id, display_name, avatar_url, email)
  values (auth.uid(), p_display_name, p_avatar_url, p_email)
  on conflict (id) do update
    set avatar_url = excluded.avatar_url,
        email = excluded.email,
        display_name = case when coalesce(pr.display_name, '') = '' then excluded.display_name else pr.display_name end
  returning pr.id, pr.display_name, pr.avatar_url, (xmax = 0) as is_new;
$$;

grant execute on function upsert_own_profile(text, text, text) to authenticated;
