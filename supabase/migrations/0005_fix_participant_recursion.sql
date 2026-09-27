-- Fixes RLS self-recursion: is_project_participant() is called from inside
-- the `projects` SELECT policy, but its own body also queries `projects` —
-- which re-triggers that same SELECT policy, recursively. Postgres's
-- recursion guard then denies visibility, which surfaces as a generic
-- "new row violates row-level security policy" error on INSERT ... RETURNING
-- (used by every .insert().select() call), even though the actual INSERT
-- was allowed. Making this SECURITY DEFINER lets its internal lookup run
-- with the function owner's privileges (bypassing RLS for this one,
-- narrowly-scoped, boolean-only check) instead of re-entering the policy.
create or replace function is_project_participant(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects where id = p_project_id and initiator_id = p_user_id
  ) or exists (
    select 1 from tracks where project_id = p_project_id and assigned_user_id = p_user_id
  );
$$;
