import type { ClipData } from "../lib/clips";

export type Clip = ClipData;

export interface Profile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** A recording: raw audio that is never modified. Clips are windows onto takes. */
export interface Take {
  id: string;
  trackId: string;
  storagePath: string;
  blob: Blob | null; // lazily downloaded from Storage on demand
  durationSec: number;
  createdBy: string;
  createdAt: number;
}

export interface Track {
  id: string;
  projectId: string;
  instrument: string;
  color: string;
  /** Default on-screen order, set by the initiator. */
  position: number;
  assignedUserId: string | null; // the only person who can record on / edit the clips of this channel
  assignedPlayerName: string | null; // display name, joined from profiles
  clips: Clip[];
  // Saved final mix — only the initiator changes these. (Solo is never saved.)
  volume: number; // 0..1
  muted: boolean;
  /** -1 (left) … 0 (centre) … +1 (right). Part of the saved final mix. */
  pan: number;
  fx: ChannelFx;
  /** The Owner or Mixer has stopped the channel's player from changing its effects. */
  fxLocked: boolean;
}

/** Per-channel insert effects (EQ, Compressor, Delay, Reverb) on the saved final mix. */
export interface ChannelFx {
  /** The power switch: with it off the channel is heard dry, whatever the settings below. Off by default. */
  fxOn: boolean;
  /** A bypass for each effect on its own. */
  eqOn: boolean;
  compOn: boolean;
  delayOn: boolean;
  reverbOn: boolean;
  eqLow: number; // dB, -12..+12
  eqMid: number; // dB, -12..+12
  eqHigh: number; // dB, -12..+12
  eqLowCutHz: number; // low cut (high-pass) corner, 20..400; 20 = off
  eqLowHz: number; // low shelf corner, 40..800
  eqMidHz: number; // mid peak centre, 200..8000
  eqHighHz: number; // high shelf corner, 1500..16000
  compThresholdDb: number; // -60..0
  compRatio: number; // 1..20 (1 = no compression)
  compAttackMs: number; // 0..200
  compReleaseMs: number; // 10..1500
  compMakeupDb: number; // 0..24
  delayTimeMs: number; // 0..1000
  delayMix: number; // 0..1 (0 = off)
  reverbMix: number; // 0..1 (0 = off)
}

export type ProjectStatus = "draft" | "published";

export interface Project {
  id: string;
  title: string;
  bpm: number;
  initiatorId: string; // the Owner: sets the tempo, adds channels, invites, publishes
  /** The one optional Mixer, who may set the final mix (volume, mute). */
  mixerId: string | null;
  mixerName: string | null;
  /** The Owner's display name (so they can be tagged in a note). */
  initiatorName: string | null;
  /** Path of the cover image in the "covers" bucket, if the Owner added one. */
  coverPath: string | null;
  /** People invited to hear the draft. */
  listeners: { userId: string; name: string | null }[];
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  tracks: Track[];
  /** Every take referenced by a clip in this song, by id. */
  takes: Record<string, Take>;
}

export interface TrackInvite {
  id: string;
  trackId: string;
  token: string;
  status: "pending" | "accepted" | "revoked";
}

/** A note one of the people on a project left for the others. */
export interface ProjectNote {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  /** Pinned to this beat of the timeline (4 beats to a bar), or null for a general note. */
  atBeat: number | null;
  /** Attached to this channel, or null. */
  trackId: string | null;
  /** People tagged with @name in the text. */
  mentions: string[];
  /** Listeners can read it too. */
  sharedWithListeners: boolean;
  /** Done notes are archived. */
  done: boolean;
  doneBy: string | null;
  createdAt: number;
}
