-- 0023 — a participant who adds a channel may create it already assigned to
-- themselves (the app does this for everyone except the Owner, so a player
-- who adds "Bass" is playing Bass without needing an invite). Until now the
-- assignment guard rejected ANY insert with an assignee unless it came
-- through an invite/claim function.
--
-- Only self-assignment at creation is added: the row's assignee must be the
-- signed-in user. Assigning someone else is still only possible through
-- assign_track_to_user / accept_track_invite, and every update of
-- assigned_user_id keeps its existing rules. (Who may INSERT a channel at
-- all is still the 0015 "any participant" policy.)
--
-- Safe to run more than once.

create or replace function guard_track_assignment()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('pyl.assign_via_rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' and new.assigned_user_id is not null and new.assigned_user_id is distinct from auth.uid() then
      raise exception 'A channel can only be assigned by accepting an invite, or created as your own.';
    end if;
    if tg_op = 'UPDATE' and new.assigned_user_id is distinct from old.assigned_user_id then
      raise exception 'A channel can only be assigned by accepting an invite, or by the initiator taking it.';
    end if;
  end if;
  return new;
end;
$$;
