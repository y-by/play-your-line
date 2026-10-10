-- 0043 — the master channel: one fader, mute and effects chain for the whole song, saved on the project.
--
--   * projects.master_volume   0..1 (it only turns the song down). 1 = 0 dB, as before. (The master's mute is
--                              personal, like solo: it is never saved.)
--   * projects.master_fx       the master's effects settings as json (EQ, compressor, limiter and their power
--                              switch). {} = everything neutral, so every existing song sounds exactly as before.
--   * projects.preview_stale   true when the master changed after the listening copy (the MP3 of a published
--                              song) was made: the Owner is reminded to refresh it. The "staging area": changes are
--                              worked on freely; what people hear on the Published list changes when it is refreshed.
--
-- Who may change the master: the Owner and the Mixer (the same people as the saved volume, mute and pan), through
-- set_master_mix below. Players and Listeners cannot. Everyone in the song hears the saved master, live.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

alter table projects add column if not exists master_volume real not null default 1;
alter table projects add column if not exists master_fx jsonb not null default '{}'::jsonb;
alter table projects add column if not exists preview_stale boolean not null default false;

alter table projects drop constraint if exists projects_master_volume_range;
alter table projects add constraint projects_master_volume_range check (master_volume >= 0 and master_volume <= 1);

alter table projects drop constraint if exists projects_master_fx_shape;
alter table projects add constraint projects_master_fx_shape check (jsonb_typeof(master_fx) = 'object' and pg_column_size(master_fx) < 4000);

-- An earlier draft of this file (run once by the owner on 2026-10-10) had a saved master mute: a master_muted column
-- and a four-argument set_master_mix. The mute is personal now, so remove those leftovers; two versions of the function
-- side by side would also make the app's call ambiguous.
drop function if exists set_master_mix(uuid, real, boolean, jsonb);
alter table projects drop column if exists master_muted;

-- Owner or Mixer saves the master. Only the fields that are passed are changed.
create or replace function set_master_mix(
  p_project_id uuid,
  p_volume real default null,
  p_fx jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1 from projects where id = p_project_id and (initiator_id = auth.uid() or mixer_id = auth.uid())
  ) then
    raise exception 'Only the owner or the mixer can change the master.';
  end if;

  if p_volume is not null and (p_volume < 0 or p_volume > 1) then
    raise exception 'The master volume goes from 0 to 1.';
  end if;
  if p_fx is not null and (jsonb_typeof(p_fx) <> 'object' or pg_column_size(p_fx) >= 4000) then
    raise exception 'The master effects are not valid.';
  end if;

  update projects
  set master_volume = coalesce(p_volume, master_volume),
      master_fx = coalesce(p_fx, master_fx),
      preview_stale = preview_stale or preview_path is not null
  where id = p_project_id;
end;
$$;

revoke execute on function set_master_mix(uuid, real, jsonb) from public, anon;
grant execute on function set_master_mix(uuid, real, jsonb) to authenticated;

-- The master columns are changed only through set_master_mix by the Mixer; the Owner may also write them
-- directly (the project's own policy). Nobody else can: the policies on projects are unchanged.
