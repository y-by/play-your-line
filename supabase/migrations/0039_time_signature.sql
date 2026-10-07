-- 0039 — the time signature: how many quarter-note beats make a bar (4 = 4/4, 3 = 3/4 ...).
-- Existing projects stay 4/4. Only the Owner can change it (the existing "only the initiator can update the
-- project" rule covers it). Unlike the tempo it can be changed at any time: the beats stay exactly where they
-- are, only the way they are grouped into bars changes. Safe to run more than once.

alter table projects add column if not exists beats_per_bar smallint not null default 4;

alter table projects drop constraint if exists projects_beats_per_bar_range;
alter table projects add constraint projects_beats_per_bar_range check (beats_per_bar between 2 and 7);
