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
}

/** Per-channel insert effects on the saved final mix — Owner/Mixer only. */
export interface ChannelFx {
  eqLow: number; // dB, -12..+12
  eqMid: number; // dB, -12..+12
  eqHigh: number; // dB, -12..+12
  compAmount: number; // 0..1 (0 = off)
  delayTimeMs: number; // 0..1000
  delayMix: number; // 0..1 (0 = off)
  reverbMix: number; // 0..1 (0 = off)
}

export const DEFAULT_CHANNEL_FX: ChannelFx = {
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compAmount: 0,
  delayTimeMs: 300,
  delayMix: 0,
  reverbMix: 0,
};

export type ProjectStatus = "draft" | "published";

export interface Project {
  id: string;
  title: string;
  bpm: number;
  initiatorId: string; // the Owner: sets the tempo, adds channels, invites, publishes
  /** The one optional Mixer, who may set the final mix (volume, mute). */
  mixerId: string | null;
  mixerName: string | null;
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
