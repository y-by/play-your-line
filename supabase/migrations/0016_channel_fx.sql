-- 0016 — per-channel EQ, Compressor, Reverb and Delay on the saved FINAL mix.
-- Same rule as volume/mute: only the Owner or the Mixer can change these
-- (the existing "owner or mixer edits the track" UPDATE policy already
-- covers any column on tracks, so no new policy is needed here).
--
-- Kept deliberately simple — one or two numbers per effect, not a full plugin:
--   eq_low/mid/high    dB, -12..+12, fixed shelf/peak frequencies
--   comp_amount        0..1 (0 = off; maps to threshold/ratio in the app)
--   delay_time_ms      0..1000
--   delay_mix          0..1 (0 = off)
--   reverb_mix         0..1 (0 = off)
--
-- Safe to run more than once.

alter table tracks
  add column if not exists eq_low double precision not null default 0,
  add column if not exists eq_mid double precision not null default 0,
  add column if not exists eq_high double precision not null default 0,
  add column if not exists comp_amount double precision not null default 0,
  add column if not exists delay_time_ms double precision not null default 300,
  add column if not exists delay_mix double precision not null default 0,
  add column if not exists reverb_mix double precision not null default 0;

alter table tracks
  drop constraint if exists tracks_eq_low_range,
  drop constraint if exists tracks_eq_mid_range,
  drop constraint if exists tracks_eq_high_range,
  drop constraint if exists tracks_comp_amount_range,
  drop constraint if exists tracks_delay_time_ms_range,
  drop constraint if exists tracks_delay_mix_range,
  drop constraint if exists tracks_reverb_mix_range;

alter table tracks
  add constraint tracks_eq_low_range check (eq_low between -12 and 12),
  add constraint tracks_eq_mid_range check (eq_mid between -12 and 12),
  add constraint tracks_eq_high_range check (eq_high between -12 and 12),
  add constraint tracks_comp_amount_range check (comp_amount between 0 and 1),
  add constraint tracks_delay_time_ms_range check (delay_time_ms between 0 and 1000),
  add constraint tracks_delay_mix_range check (delay_mix between 0 and 1),
  add constraint tracks_reverb_mix_range check (reverb_mix between 0 and 1);
