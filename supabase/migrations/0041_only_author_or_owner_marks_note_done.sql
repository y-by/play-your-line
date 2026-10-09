-- 0041 — only the author of a note or the Owner may mark it done or reopen it.
-- Until now any Owner, Mixer or Player could tick another person's note as done (0032 allowed it on purpose).
-- Text, pin, channel, tags and "shared with listeners" were already author-or-Owner only (0033); done joins them.
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

create or replace function guard_project_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
begin
  if new.project_id is distinct from old.project_id or new.author_id is distinct from old.author_id then
    raise exception 'A note cannot change its project or author.';
  end if;

  if auth.uid() is not null then
    select p.initiator_id = auth.uid() into v_is_owner from projects p where p.id = old.project_id;
    if old.author_id <> auth.uid() and not coalesce(v_is_owner, false) then
      if new.body is distinct from old.body
         or new.at_beat is distinct from old.at_beat
         or new.track_id is distinct from old.track_id
         or new.shared_with_listeners is distinct from old.shared_with_listeners
         or new.mentions is distinct from old.mentions
         or new.done is distinct from old.done then
        raise exception 'Only the author or the owner can change a note, or mark it done.';
      end if;
    end if;
  end if;

  if new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() else null end;
    new.done_at := case when new.done then now() else null end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
