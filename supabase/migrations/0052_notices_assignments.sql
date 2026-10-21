-- 0052 — notices for everything the Owner does TO a person: put on a channel, taken off one, added to the project,
-- made or un-made Mixer. (0051 made the notices table and the hand-over / someone-left notices.)
--
-- Done with triggers, so it holds whichever function or screen makes the change. Nothing is sent when people change
-- their OWN seat (accepting a link, claiming a channel, leaving), only when someone else does it to them. Later this
-- same table can feed push notifications or email.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (after 0051).

alter table user_notices add column if not exists item text;

alter table user_notices drop constraint if exists user_notices_kind_check;
alter table user_notices add constraint user_notices_kind_check check (kind in (
  'project_handed_over', 'member_left', 'added_to_project', 'channel_assigned', 'channel_removed', 'mixer_assigned', 'mixer_removed'
));

create or replace function pyl_notice(p_user uuid, p_kind text, p_project uuid, p_item text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_user is null or v_actor is null or p_user = v_actor then
    return;
  end if;
  insert into user_notices (user_id, kind, project_id, project_title, from_name, item)
  select p_user, p_kind, p_project, p.title, (select display_name from profiles where id = v_actor), p_item
  from projects p where p.id = p_project;
end;
$$;

revoke execute on function pyl_notice(uuid, text, uuid, text) from public, anon, authenticated;

-- A channel's player changes.
create or replace function notify_track_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid := case when tg_op = 'UPDATE' then old.assigned_user_id else null end;
begin
  if new.assigned_user_id is distinct from v_old then
    -- Someone giving up their own channel (leaving) is not news for them; the Owner hears about it separately.
    if v_old is not null and v_old is distinct from auth.uid() then
      perform pyl_notice(v_old, 'channel_removed', new.project_id, new.instrument);
    end if;
    if new.assigned_user_id is not null and v_old is distinct from auth.uid() then
      perform pyl_notice(new.assigned_user_id, 'channel_assigned', new.project_id, new.instrument);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tracks_notify_assignment on tracks;
create trigger tracks_notify_assignment
  after insert or update of assigned_user_id on tracks
  for each row execute function notify_track_assignment();

-- The Mixer seat changes.
create or replace function notify_mixer_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mixer_id is distinct from old.mixer_id then
    -- A person who just became the Owner is told that instead (0051).
    if old.mixer_id is not null and old.mixer_id is distinct from new.initiator_id then
      perform pyl_notice(old.mixer_id, 'mixer_removed', new.id, null);
    end if;
    if new.mixer_id is not null then
      perform pyl_notice(new.mixer_id, 'mixer_assigned', new.id, null);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists projects_notify_mixer on projects;
create trigger projects_notify_mixer
  after update of mixer_id on projects
  for each row execute function notify_mixer_change();

-- Added to the project (by email or pick) rather than joining through a link.
create or replace function notify_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pyl_notice(new.user_id, 'added_to_project', new.project_id, null);
  return null;
end;
$$;

drop trigger if exists listeners_notify_added on project_listeners;
create trigger listeners_notify_added
  after insert on project_listeners
  for each row execute function notify_member_added();

revoke execute on function notify_track_assignment() from public, anon, authenticated;
revoke execute on function notify_mixer_change() from public, anon, authenticated;
revoke execute on function notify_member_added() from public, anon, authenticated;
