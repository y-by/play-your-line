-- 0056 — a person who is tagged (@name) in a note gets a notice: the popup, and the news line on that project's card.
--
-- Sent when the note is written, and again for anyone tagged LATER by editing it (not for people already tagged).
-- Not for tagging yourself, and not for a plain Listener when the note is not shared with listeners (they cannot read it).
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (after 0055).

alter table user_notices drop constraint if exists user_notices_kind_check;
alter table user_notices add constraint user_notices_kind_check check (kind in (
  'project_handed_over', 'member_left', 'added_to_project', 'channel_assigned', 'channel_removed', 'mixer_assigned', 'mixer_removed',
  'note_tagged'
));

create or replace function notify_note_tagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  foreach v_user in array coalesce(new.mentions, '{}') loop
    if tg_op = 'UPDATE' and v_user = any (coalesce(old.mentions, '{}')) then
      continue;
    end if;
    if is_project_contributor(new.project_id, v_user)
       or (new.shared_with_listeners and is_project_participant(new.project_id, v_user)) then
      perform pyl_notice(v_user, 'note_tagged', new.project_id, left(new.body, 80));
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists notes_notify_tagged on project_notes;
create trigger notes_notify_tagged
  after insert or update of mentions on project_notes
  for each row execute function notify_note_tagged();

revoke execute on function notify_note_tagged() from public, anon, authenticated;
