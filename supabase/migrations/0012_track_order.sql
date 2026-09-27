-- 0012 — the default order of channels on screen. Only the initiator changes
-- it (the tracks UPDATE policy already allows only the initiator). Everyone
-- else can arrange channels for themselves, but that stays on their own
-- device and never touches this column.
--
-- Safe to run more than once.

alter table tracks add column if not exists position integer not null default 0;

-- Give existing channels a position that matches how they were created.
update tracks t
set position = ranked.pos
from (
  select id, row_number() over (partition by project_id order by created_at, id) - 1 as pos
  from tracks
) ranked
where t.id = ranked.id and t.position = 0;
