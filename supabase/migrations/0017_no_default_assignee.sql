-- 0017 — a new channel must start unclaimed. This app's own insert (addTrack)
-- never sets assigned_user_id, so if the column has ANY default expression —
-- most plausibly auth.uid(), likely added by hand through the Supabase table
-- editor rather than one of our tracked migrations — a fresh channel would
-- silently come out already assigned to whoever created it. Explicitly
-- removing any default makes a new row's assignment always null, matching
-- what every migration and the app's own code has always assumed.
--
-- Harmless (and a no-op) if there was never a default in the first place.
-- Safe to run more than once.

alter table tracks alter column assigned_user_id drop default;
