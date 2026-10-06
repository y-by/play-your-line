-- 0035 — a fade in and a fade out on each clip (seconds; 0 = none). They are part of the clip, so they are
-- saved, shared live, undoable, and heard in playback and in Export Mix. Safe to run more than once.

alter table clips
  add column if not exists fade_in_sec double precision not null default 0,
  add column if not exists fade_out_sec double precision not null default 0;

alter table clips drop constraint if exists clips_fade_in_range;
alter table clips drop constraint if exists clips_fade_out_range;
alter table clips
  add constraint clips_fade_in_range check (fade_in_sec >= 0 and fade_in_sec <= 600),
  add constraint clips_fade_out_range check (fade_out_sec >= 0 and fade_out_sec <= 600);
