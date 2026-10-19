-- 0047 — the master fader goes up to +6 dB (gain 1.9953), like a channel fader. Before, 0043 only allowed 0 to 1.
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor. Run it before pushing the app that
-- lets the fader past 0 dB; until then a master above 0 dB would be refused when saved.

alter table projects drop constraint if exists projects_master_volume_range;
alter table projects add constraint projects_master_volume_range check (master_volume >= 0 and master_volume <= 2);

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

  if p_volume is not null and (p_volume < 0 or p_volume > 2) then
    raise exception 'The master volume goes from 0 to 2 (up to +6 dB).';
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
