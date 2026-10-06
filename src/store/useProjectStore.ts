import { create } from "zustand";
import type { ProjectNote, Project, Track, Clip, ChannelFx } from "../types/project";
import { AudioEngine, type RecordingResult } from "../lib/audioEngine";
import { useAuthStore } from "./useAuthStore";
import * as api from "../lib/projectApi";
import { listInputDevices, probeChannelCount, resolveInputDeviceId, type InputDevice, DEFAULT_DEVICE_ID } from "../lib/inputDevices";
import { listOutputDevices, type OutputDevice } from "../lib/outputDevices";
import { nextZ, splitClip, duplicateClip, moveClip, audibleSegments } from "../lib/clips";
import { encodeWavFloat32 } from "../lib/wav";
import { detectChords, type ChordSegment } from "../lib/chords";
import { stepSec, beatSec, BEATS_PER_BAR, type SnapResolution } from "../lib/grid";
import { clipEnd as clipEndSec } from "../lib/clips";
import { effectiveChannelMix } from "../lib/mix";
import { subscribeToProject, type RealtimeStatus, type PresentUser } from "../lib/realtime";
import { TRACK_COLORS } from "../lib/trackColors";
import { findOrphanFiles, takeIdFromFileName } from "../lib/orphans";
import { upsertClip, removeClip } from "../lib/remoteMerge";
import { orderTracks, moveId } from "../lib/trackOrder";
import { prepareCoverImage } from "../lib/coverImage";
import { clampFx, fxFromRow, presetPatch, resetPatch } from "../lib/channelFx";
import { rolesOf, roleBadge, canMixFinal } from "../lib/roles";

/** The useful part of a Supabase / network error, for showing to the person. */
function errorDetail(err: unknown): string {
  const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return message ? ` (${message})` : "";
}

// Supabase's default per-object storage limit. Checked client-side before
// uploading a dropped file, so a too-long file gets a clear explanation
// instead of a raw storage error after the upload already ran.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const MIN_BPM = 20;
const MAX_BPM = 300;


function currentUserId(): string | null {
  return useAuthStore.getState().userId;
}

/** A just-finished recording, kept on screen while it is saved and then eased into the clip that replaces it. */
export interface RecordingGhost {
  trackId: string;
  startSec: number;
  durationSec: number;
  binSec: number;
  peaks: Float32Array;
  /** Set once the saved clip exists: where the ghost slides to before fading out. */
  target: { startSec: number; durationSec: number } | null;
}

/** How long the finished recording takes to settle into its clip (matches the CSS transition). */
const GHOST_SETTLE_MS = 700;

interface ProjectState {
  project: Project | null;
  projectLoading: boolean;
  projectError: string | null;
  engine: AudioEngine;

  isInitiator: () => boolean;
  /** Owner, Mixer, an assigned player, or an invited Listener — anyone this song is shared with. */
  isParticipant: () => boolean;
  /** True for a channel's assigned player only. The initiator can NOT edit a player's clips or record on their channel. */
  canEditClips: (track: Track) => boolean;
  /** The Owner and the Mixer set the saved final mix. */
  canMix: () => boolean;
  /** The Owner, the Mixer, or a channel's own assigned player may use that channel's FX. */
  canUseFx: (track: Track) => boolean;
  /** Small badge text for this person: "Owner", "Mixer", "Player", "Listener"… */
  roleLabel: () => string | null;
  /** Owner only: a link that makes someone the song's Mixer or a Listener. */
  createRoleInvite: (role: api.InviteRole) => Promise<string>;
  /** Owner picks an existing participant as the Mixer (or null to clear it). */
  setMixer: (userId: string | null) => Promise<void>;
  removeListener: (userId: string) => Promise<void>;
  /** Owner: add someone with an account by email. Throws a readable error if there is no such account. */
  addMemberByEmail: (email: string) => Promise<string>;

  /** Tempo locks as soon as the song has any clip. */
  tempoLocked: () => boolean;

  loadProject: (id: string) => Promise<void>;
  renameProject: (title: string) => Promise<void>;
  setTempo: (bpm: number) => Promise<void>;
  metronomeEnabled: boolean;
  toggleMetronome: () => void;
  metronomeVolume: number;
  setMetronomeVolume: (volume: number) => void;
  testMetronomeClick: () => void;
  countInEnabled: boolean;
  setCountInEnabled: (enabled: boolean) => void;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  recordingTrackId: string | null;
  recordingPhase: "idle" | "requesting-mic" | "count-in" | "recording" | "uploading";
  recordingError: string | null;
  /** A calm heads-up (not a failure), shown in a neutral toast. */
  recordingNotice: string | null;
  recordingGhost: RecordingGhost | null;

  availableInputs: InputDevice[];
  inputDeviceId: string;
  inputChannelCount: number;
  inputChannelIndex: number | null;
  inputLevel: number;
  /** Peak of the microphone, linear 0..1, eased so the lights fall smoothly (for the level lights). */
  inputPeak: number;
  /** Same for each channel's own audio, post-fader. */
  trackPeaks: Record<string, number>;
  /** Each channel's own live output level (post-fader) — 0..1, keyed by track id. */
  trackLevels: Record<string, number>;
  loadingInputs: boolean;
  refreshInputDevices: () => Promise<void>;
  setInputDevice: (deviceId: string) => Promise<void>;
  setInputChannel: (channelIndex: number | null) => void;

  availableOutputs: OutputDevice[];
  outputDeviceId: string;
  metronomeOutputDeviceId: string | null;
  masterOutputRoutingSupported: boolean;
  metronomeOutputRoutingSupported: boolean;
  loadingOutputs: boolean;
  refreshOutputDevices: () => Promise<void>;
  setOutputDevice: (deviceId: string) => Promise<void>;
  setMetronomeOutputDevice: (deviceId: string | null) => Promise<void>;

  // Round-trip latency compensation (null = automatic estimate).
  latencyCompMs: number | null;
  estimatedLatencyMs: number;
  calibrationState: "idle" | "running" | "done" | "failed";
  calibrationMessage: string | null;
  setLatencyCompMs: (ms: number | null) => void;
  refreshEstimatedLatency: () => void;
  calibrateLatency: () => Promise<void>;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  addTrack: (instrument: string) => Promise<void>;
  /** Initiator only, and only while the channel is empty. */
  removeTrack: (trackId: string) => Promise<void>;
  // Channel order on screen. The initiator's arrangement is the song's default
  // (saved for everyone); anyone else arranges only for themselves, on this device.
  /** Channel colours: the initiator's choice is saved for everyone; anyone else recolours only for themselves. */
  personalColors: Record<string, string>;
  setTrackColor: (trackId: string, color: string) => Promise<void>;
  /** Any participant may rename a channel's instrument label. */
  renameTrack: (trackId: string, instrument: string) => Promise<void>;
  personalOrder: string[] | null;
  moveTrack: (trackId: string, toIndex: number) => Promise<void>;
  resetOrder: () => void;

  /** The initiator takes an unassigned channel to play it themselves. */
  claimChannel: (trackId: string) => Promise<void>;
  /** Owner assigns an unclaimed channel straight to a known participant — no invite/accept step. */
  assignTrackToUser: (trackId: string, userId: string) => Promise<void>;
  /** Owner moves a claimed channel to someone else, or null to make it unclaimed. Only while it has no clips. */
  reassignTrack: (trackId: string, userId: string | null) => Promise<void>;
  /** Same, but looks the person up by email first. Throws if nobody's signed up with that email yet. */
  assignTrackByEmail: (trackId: string, email: string) => Promise<void>;

  // Mixing. The initiator's levels are the saved FINAL mix. Everyone else
  // hears through a personal "monitor" mix that is never saved to the song.
  listeningMode: "monitor" | "final";
  setListeningMode: (mode: "monitor" | "final") => void;
  monitor: Record<string, { volume: number; muted: boolean }>;
  localSolo: Record<string, boolean>;
  canAdjustMix: () => boolean;
  effectiveMix: (track: Track) => { volume: number; muted: boolean; solo: boolean };
  setChannelVolume: (trackId: string, volume: number) => void;
  /** Owner / Mixer only (the saved final mix): -1 left … +1 right. */
  setChannelPan: (trackId: string, pan: number) => void;
  toggleChannelMute: (trackId: string) => void;
  /** Master mute: mutes every channel, or un-mutes them all. Follows the same rules as a single channel's M. */
  setAllMuted: (muted: boolean) => void;
  toggleChannelSolo: (trackId: string) => void;
  /** EQ, Compressor, Delay and Reverb on the saved final mix: the Owner, the Mixer, and (unless it is locked) the channel's player. */
  setChannelFx: (trackId: string, patch: Partial<ChannelFx>, opts?: { checkpoint?: boolean }) => void;
  /** Steps the channel's effects back to how they were before the last change (kept for this visit only). */
  undoChannelFx: (trackId: string) => void;
  /** How many steps can be undone, per channel. */
  fxUndoCount: Record<string, number>;
  /** Every effect setting back to neutral (the power switch and bypasses stay as they are). Can be undone. */
  resetChannelFx: (trackId: string) => void;
  /** Sets the channel's effects from a starting point and switches FX on. Can be undone. */
  applyFxPreset: (trackId: string, presetId: string) => void;
  /** Hearing a channel without its effects, just on this device, to compare. Never saved or shared. */
  fxCompare: Record<string, boolean>;
  setFxCompare: (trackId: string, dry: boolean) => void;
  /** Owner/Mixer: stop (or allow) the channel's player changing its effects. */
  setFxLocked: (trackId: string, locked: boolean) => void;

  // Clip editing
  // Loop: a highlighted part of the song that repeats while playing. Personal
  // and temporary (never saved). Kept in beats so it follows the grid if the tempo changes.
  loop: { startBeat: number; endBeat: number } | null;
  loopEnabled: boolean;
  setLoopRegion: (startBeat: number, endBeat: number) => void;
  toggleLoop: () => void;
  /** Turn off every solo (solo is a personal listening aid). */
  clearSolo: () => void;
  /** Which of your own channels the Record button records onto. */
  armedTrackId: string | null;
  armTrack: (trackId: string) => void;
  /** The armed channel if it is still yours, otherwise your first channel. */
  effectiveArmedId: () => string | null;
  /** The bar's Record button: stop if recording, otherwise record on the armed channel. */
  toggleRecord: () => void;

  /** Timeline zoom (screen pixels per beat). Not saved. */
  pxPerBeat: number;
  setPxPerBeat: (pxPerBeat: number) => void;
  /** Whether the timeline scrolls to keep the playhead in view. Saved on this device. */
  followPlayhead: boolean;
  setFollowPlayhead: (follow: boolean) => void;
  snapEnabled: boolean;
  snapResolution: SnapResolution;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapResolution: (resolution: SnapResolution) => void;
  selectedClip: { trackId: string; clipId: string } | null;
  selectClip: (selection: { trackId: string; clipId: string } | null) => void;
  /** Replaces a channel's clips (the one path every edit goes through). Resolves false if saving failed. */
  commitClips: (trackId: string, next: Clip[], opts?: { skipHistory?: boolean }) => Promise<boolean>;
  splitSelected: () => Promise<void>;
  duplicateSelected: () => Promise<void>;
  deleteSelected: () => Promise<void>;
  nudgeSelected: (direction: -1 | 1, fine: boolean) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  historyCounts: { undo: number; redo: number };
  /** Bumped whenever new audio is decoded, so waveforms know to redraw. */
  takesVersion: number;
  editError: string | null;

  /** Are we hearing other people's changes as they happen? */


  // ---- Chords (our own detector; suggestions only, recalculated on request, not saved) ----
  /** Detected chords per channel, on the project's beat grid. Cleared when that channel's clips or the tempo change. */
  chords: Record<string, ChordSegment[]>;
  chordsShown: Record<string, boolean>;
  detectingChords: string | null;
  /** First press: listen to the channel and show its chords. After that: show / hide them. */
  toggleChords: (trackId: string) => Promise<void>;

  // ---- Notes ----
  notes: ProjectNote[];
  /** Master switch for the notes tray, the floating cards and the flags on the timeline. Saved on this device. */
  notesVisible: boolean;
  setNotesVisible: (visible: boolean) => void;
  notesTrayOpen: boolean;
  setNotesTrayOpen: (open: boolean) => void;
  /** A note that just tagged me (shown as a message at the top until dismissed or opened). */
  noteAlert: { id: string; from: string } | null;
  dismissNoteAlert: () => void;
  openNoteAlert: () => void;
  /** Notes popped out as floating cards, with where they sit and whether they are minimised to the bottom row. */
  noteCards: Record<string, { x: number; y: number; min: boolean }>;
  floatNote: (id: string) => void;
  moveNoteCard: (id: string, x: number, y: number) => void;
  minimizeNoteCard: (id: string, min: boolean) => void;
  unfloatNote: (id: string) => void;
  /** The flag on the timeline whose bubble is open. */
  openFlagId: string | null;
  setOpenFlag: (id: string | null) => void;
  /** Show only the notes attached to this channel in the tray (null = all). */
  noteChannelFilter: string | null;
  showChannelNotes: (trackId: string | null) => void;
  /** Owner, Mixer or a Player may write notes; Listeners may only read the ones shared with them. */
  canWriteNotes: () => boolean;
  addNote: (input: { body: string; atBeat: number | null; trackId: string | null; mentions: string[]; sharedWithListeners: boolean }) => Promise<void>;
  editNote: (id: string, patch: Partial<{ body: string; atBeat: number | null; trackId: string | null; mentions: string[]; sharedWithListeners: boolean }>) => Promise<void>;
  setNoteDone: (id: string, done: boolean) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  jumpToNote: (id: string) => void;

  realtimeStatus: RealtimeStatus | "off";
  /** Who has this song open right now. */
  presentUsers: PresentUser[];
  /** Stop listening for changes and playback (call when leaving the song). */
  leaveProject: () => void;

  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;

  /** Imports an audio file dropped on a channel as a new clip, placed at `atSec`. */
  importAudioFile: (trackId: string, file: File, atSec: number) => Promise<void>;
  /** A channel currently importing a dropped file (for a small "Importing…" hint). */
  importingTrackId: string | null;

  startRecording: (trackId: string) => Promise<void>;
  stopRecording: () => Promise<void>;

  createInvite: (trackId: string) => Promise<string>;
  publish: () => Promise<void>;
  /** Owner only: take a published song back to a draft. */
  unpublish: () => Promise<void>;
  /** Owner only: sets (or, with null, removes) the project's cover image. Throws if it couldn't. */
  setProjectCover: (file: File | null) => Promise<void>;
  /** Owner only, irreversible: deletes the project and all its recordings. Throws if it couldn't. */
  deleteProject: () => Promise<void>;
}

const LATENCY_STORAGE_KEY = "pyl.latencyMs";
const COUNT_IN_STORAGE_KEY = "pyl.countIn";
const COUNT_IN_BEATS = 4;
const SNAP_ENABLED_KEY = "pyl.snapEnabled";
const SNAP_RESOLUTION_KEY = "pyl.snapResolution";
const FOLLOW_KEY = "pyl.followPlayhead";
const monitorKey = (projectId: string) => `pyl.monitor.${projectId}`;
const orderKey = (projectId: string) => `pyl.order.${projectId}`;
const colorsKey = (projectId: string) => `pyl.colors.${projectId}`;

function readPersonalColors(projectId: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(colorsKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readPersonalOrder(projectId: string): string[] | null {
  try {
    const raw = localStorage.getItem(orderKey(projectId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writePersonalOrder(projectId: string, order: string[] | null) {
  try {
    if (order) localStorage.setItem(orderKey(projectId), JSON.stringify(order));
    else localStorage.removeItem(orderKey(projectId));
  } catch {
    // Not being able to remember the order is fine; it just resets next visit.
  }
}

function readStoredSnapEnabled(): boolean {
  try {
    return localStorage.getItem(SNAP_ENABLED_KEY) !== "off"; // on by default
  } catch {
    return true;
  }
}


const NOTES_VISIBLE_KEY = "pyl.notesVisible";
const noteCardsKey = (projectId: string) => `pyl.noteCards.${projectId}`;

function readNotesVisible(): boolean {
  try {
    return localStorage.getItem(NOTES_VISIBLE_KEY) === "on"; // off by default
  } catch {
    return false;
  }
}

function readNoteCards(projectId: string): Record<string, { x: number; y: number; min: boolean }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(noteCardsKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeNoteCards(projectId: string, cards: Record<string, { x: number; y: number; min: boolean }>) {
  try {
    localStorage.setItem(noteCardsKey(projectId), JSON.stringify(cards));
  } catch {
    // not remembering where the cards sit is fine
  }
}

function readStoredFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== "off"; // on by default
  } catch {
    return true;
  }
}

function readStoredSnapResolution(): SnapResolution {
  try {
    const raw = localStorage.getItem(SNAP_RESOLUTION_KEY);
    if (raw === "bar" || raw === "beat" || raw === "eighth" || raw === "sixteenth") return raw;
  } catch {
    // fall through to the default
  }
  return "sixteenth";
}

function readMonitor(projectId: string): Record<string, { volume: number; muted: boolean }> {
  try {
    const raw = localStorage.getItem(monitorKey(projectId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMonitor(projectId: string, monitor: Record<string, { volume: number; muted: boolean }>) {
  try {
    localStorage.setItem(monitorKey(projectId), JSON.stringify(monitor));
  } catch {
    // storage unavailable — the personal mix just won't persist
  }
}

const EPS = 1e-9;
function sameClip(a: Clip, b: Clip): boolean {
  return (
    a.takeId === b.takeId &&
    a.z === b.z &&
    Math.abs(a.startSec - b.startSec) < EPS &&
    Math.abs(a.sourceStartSec - b.sourceStartSec) < EPS &&
    Math.abs(a.durationSec - b.durationSec) < EPS
  );
}

interface HistoryEntry {
  trackId: string;
  before: Clip[];
  after: Clip[];
}
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
const pendingMixSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Partial<{ volume: number; muted: boolean }> }>();
/** Undo steps for each channel's effects, and when each channel's current undo step was started. */
const fxUndoStacks = new Map<string, ChannelFx[]>();
const fxLastCheckpoint = new Map<string, number>();
const pendingFxSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Partial<ChannelFx> }>();
let countInTimer: ReturnType<typeof setTimeout> | null = null;

function clearCountInTimer() {
  if (countInTimer !== null) {
    clearTimeout(countInTimer);
    countInTimer = null;
  }
}

function readStoredCountIn(): boolean {
  try {
    return localStorage.getItem(COUNT_IN_STORAGE_KEY) !== "off"; // on by default
  } catch {
    return true;
  }
}

function readStoredLatencyMs(): number | null {
  try {
    const raw = localStorage.getItem(LATENCY_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

let unsubscribeRealtime: (() => void) | null = null;
function stopRealtime() {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const engine = new AudioEngine();
  const initialLatencyMs = readStoredLatencyMs();
  engine.setLatencyCompensationSec(initialLatencyMs === null ? null : initialLatencyMs / 1000);
  engine.onUpdate(({ isPlaying, positionSec }) => set({ isPlaying, positionSec }));
  // Peak meters rise instantly and fall at a steady, calm rate (about 19 dB a second), so the lights
  // don't flicker with every note.
  let easedInputPeak = 0;
  engine.onLevel((inputLevel, peak) => {
    easedInputPeak = Math.max(peak, easedInputPeak * 0.965);
    set({ inputLevel, inputPeak: easedInputPeak });
  });
  let easedTrackPeaks: Record<string, number> = {};
  engine.onTrackLevels((trackLevels, peaks) => {
    const next: Record<string, number> = {};
    for (const id of Object.keys(peaks)) next[id] = Math.max(peaks[id], (easedTrackPeaks[id] ?? 0) * 0.95);
    easedTrackPeaks = next;
    set({ trackLevels, trackPeaks: next });
  });

  // Pushes the effective mix (saved final mix, or this person's personal
  // monitor mix) for every channel into the audio engine.
  const syncMixToEngine = () => {
    const { project } = get();
    if (!project) return;
    for (const track of project.tracks) {
      const m = get().effectiveMix(track);
      engine.updateTrackMix(track.id, m.volume, m.muted, m.solo);
      engine.setTrackPan(track.id, track.pan);
    }
  };

  // Pushes the loop (converted from beats to seconds at the current tempo) into the audio engine.
  const syncLoop = () => {
    const { project, loop, loopEnabled } = get();
    if (!project || !loop || !loopEnabled) {
      engine.setLoop(null);
      return;
    }
    const beat = beatSec(project.bpm);
    engine.setLoop({ startSec: loop.startBeat * beat, endSec: loop.endBeat * beat });
  };

  // Signal lights: live whenever there's a reason to want them (armed to
  // record, actually recording, or — for anyone who owns a channel — just
  // listening to the song, so you can check your level while playing along).
  // Resolves "default" to a concrete device each time, so a stale alias
  // never silently reads nothing.
  const startInputMeter = async () => {
    const resolved = await resolveInputDeviceId(get().inputDeviceId);
    await engine.startMonitoring(resolved, get().inputChannelIndex);
  };
  const stopInputMeterIfIdle = () => {
    if (!get().armedTrackId && !get().recordingTrackId && !get().isPlaying) engine.stopMonitoring();
  };

  const updateHistoryCounts = () => set({ historyCounts: { undo: undoStack.length, redo: redoStack.length } });

  // Applies a channel's clip list to state and to the engine.
  const applyTrackClips = (trackId: string, clips: Clip[]) => {
    const { project, selectedClip } = get();
    if (!project) return;
    const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, clips } : t));
    engine.setTrackClips(trackId, clips);
    if (get().chords[trackId]) {
      const { [trackId]: _stale, ...rest } = get().chords;
      void _stale;
      set({ chords: rest });
    }
    const stillSelected = !selectedClip || selectedClip.trackId !== trackId || clips.some((c) => c.id === selectedClip.clipId);
    set({
      project: { ...project, tracks },
      durationSec: engine.getProjectDurationSec(),
      ...(stillSelected ? {} : { selectedClip: null }),
    });
  };

  // The initiator drags a volume slider: update instantly, save once they pause.
  const scheduleMixSave = (trackId: string, patch: Partial<{ volume: number; muted: boolean; pan: number }>) => {
    const existing = pendingMixSaves.get(trackId);
    if (existing) clearTimeout(existing.timer);
    const merged = { ...(existing?.patch ?? {}), ...patch };
    const timer = setTimeout(async () => {
      pendingMixSaves.delete(trackId);
      try {
        await api.updateTrackMix(trackId, merged);
      } catch (err) {
        console.error("Failed to save the mix:", err);
        set({ editError: "Couldn't save that mix change." });
      }
    }, 250);
    pendingMixSaves.set(trackId, { timer, patch: merged });
  };

  // Same pattern for EQ/Compressor/Delay/Reverb: apply instantly, save once the knob settles.
  const scheduleFxSave = (trackId: string, patch: Partial<ChannelFx>) => {
    const existing = pendingFxSaves.get(trackId);
    if (existing) clearTimeout(existing.timer);
    const merged = { ...(existing?.patch ?? {}), ...patch };
    const timer = setTimeout(async () => {
      pendingFxSaves.delete(trackId);
      try {
        await api.updateTrackFx(trackId, merged);
      } catch (err) {
        console.error("Failed to save the effect:", err);
        set({ editError: "Couldn't save that effect change." });
      }
    }, 250);
    pendingFxSaves.set(trackId, { timer, patch: merged });
  };

  /** Changes the channel's effects on screen, in the sound, and (once it settles) in the database. */
  const applyFxNow = (trackId: string, patch: Partial<ChannelFx>) => {
    const project = get().project;
    const track = project?.tracks.find((t) => t.id === trackId);
    if (!project || !track) return;
    const clean = clampFx(patch);
    set({ project: { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, fx: { ...t.fx, ...clean } } : t)) } });
    engine.updateTrackFx(trackId, clean);
    scheduleFxSave(trackId, clean);
  };

  // ---- Live changes from other people -------------------------------------
  // Their clips and channels appear without a refresh. Nothing here restarts
  // playback: an added or moved clip is heard from the next Play.

  const ensureTakeLoaded = async (takeId: string) => {
    const known = get().project?.takes[takeId];
    if (known && engine.getTakeBuffer(takeId)) return;
    const take = known ?? (await api.fetchTake(takeId));
    if (!take.blob) take.blob = await api.downloadTakeBlob(take.storagePath);
    await engine.loadTake(take.id, take.blob);
    const current = get().project;
    if (!current) return;
    set({ project: { ...current, takes: { ...current.takes, [take.id]: take } }, takesVersion: get().takesVersion + 1 });
  };

  const setTracksQuietly = (tracks: Track[]) => {
    const { project } = get();
    if (!project) return;
    for (const t of tracks) engine.setTrackClips(t.id, t.clips, { reschedule: false });
    set({ project: { ...project, tracks }, durationSec: engine.getProjectDurationSec() });
  };

  const handleClipChange = async (type: "INSERT" | "UPDATE" | "DELETE", row: { id: string; track_id?: string }) => {
    const project = get().project;
    if (!project) return;
    if (type === "DELETE") {
      const tracks = removeClip(project.tracks, row.id);
      if (tracks !== project.tracks) setTracksQuietly(tracks);
      return;
    }
    const track = project.tracks.find((t) => t.id === row.track_id);
    if (!track) return; // another song's channel
    // You are the only one who edits your own channel, so your own edits come back as echoes — ignore them.
    if (get().canEditClips(track)) return;
    const clip = api.mapClip(row);
    try {
      await ensureTakeLoaded(clip.takeId);
    } catch (err) {
      console.error("Couldn't load a new recording:", err);
      return;
    }
    const latest = get().project;
    if (!latest) return;
    const tracks = upsertClip(latest.tracks, track.id, clip);
    if (tracks !== latest.tracks) setTracksQuietly(tracks);
  };

  const handleTrackChange = async (type: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>) => {
    const project = get().project;
    if (!project) return;
    const id = row.id as string;
    if (type === "DELETE") {
      engine.removeTrack(id);
      set({ project: { ...project, tracks: project.tracks.filter((t) => t.id !== id) }, durationSec: engine.getProjectDurationSec() });
      return;
    }
    const assignedUserId = (row.assigned_user_id as string | null) ?? null;
    const existing = project.tracks.find((t) => t.id === id);
    let name = existing && existing.assignedUserId === assignedUserId ? existing.assignedPlayerName : null;
    if (assignedUserId && !name) {
      try {
        name = await api.fetchDisplayName(assignedUserId);
      } catch {
        name = null;
      }
    }
    const latest = get().project;
    if (!latest) return;
    const found = latest.tracks.find((t) => t.id === id);
    if (!found) {
      const track = api.mapTrack(row, [], name);
      engine.setTrackClips(track.id, [], { reschedule: false });
      set({ project: { ...latest, tracks: [...latest.tracks, track] } });
    } else {
      const ownsOrder = get().isInitiator();
      // While one of my own mix/FX changes is still being saved, its echo must not fight the control.
      const savingMix = pendingMixSaves.has(id);
      const savingFx = pendingFxSaves.has(id);
      const updated: Track = {
        ...found,
        instrument: row.instrument as string,
        color: row.color as string,
        assignedUserId,
        assignedPlayerName: name,
        fxLocked: (row.fx_locked as boolean | undefined) ?? found.fxLocked,
        ...(savingMix ? {} : { volume: row.volume as number, muted: row.muted as boolean, pan: (row.pan as number) ?? found.pan }),
        ...(savingFx
          ? {}
          : { fx: fxFromRow(row, found.fx) }),
        // The Owner's own order is what they just dragged; everyone else follows the saved default.
        ...(ownsOrder ? {} : { position: (row.position as number) ?? found.position }),
      };
      if (!savingFx) engine.updateTrackFx(id, updated.fx);
      set({ project: { ...latest, tracks: latest.tracks.map((t) => (t.id === id ? updated : t)) } });
    }
    syncMixToEngine();
  };

  const handleProjectChange = (row: Record<string, unknown>) => {
    const project = get().project;
    if (!project) return;
    const bpm = row.bpm as number;
    if (bpm !== project.bpm) engine.setBpm(bpm);
    const mixerId = (row.mixer_id as string | null) ?? null;
    if (mixerId !== project.mixerId) {
      // Someone new became (or stopped being) the Mixer: look up the name.
      if (mixerId) {
        void api.fetchDisplayName(mixerId).then((name) => {
          const current = get().project;
          if (current && current.mixerId === mixerId) set({ project: { ...current, mixerName: name } });
        });
      }
    }
    set({
      project: {
        ...project,
        mixerId,
        mixerName: mixerId && mixerId === project.mixerId ? project.mixerName : null,
        title: row.title as string,
        bpm,
        status: row.status as Project["status"],
        publishedAt: row.published_at ? new Date(row.published_at as string).getTime() : null,
      },
    });
  };

  // Catch up after a dropped connection or a phone waking up: reload the song's
  // rows quietly, reusing recordings we already have.
  const syncFromServer = async () => {
    const current = get().project;
    if (current) void refreshNotes(current.id);
    if (!current || get().recordingTrackId || get().isPlaying) return;
    try {
      const fresh = await api.getProject(current.id);
      for (const take of Object.values(fresh.takes)) {
        const have = current.takes[take.id];
        if (have?.blob) take.blob = have.blob;
      }
      await api.hydrateTakeBlobs(fresh);
      for (const take of Object.values(fresh.takes)) {
        if (take.blob && !engine.getTakeBuffer(take.id)) await engine.loadTake(take.id, take.blob);
      }
      const latest = get().project;
      if (!latest || latest.id !== fresh.id) return;
      for (const t of latest.tracks) if (!fresh.tracks.some((f) => f.id === t.id)) engine.removeTrack(t.id);
      // Keep our own channel exactly as we have it; the server copy may lag behind an edit still being saved.
      const tracks = fresh.tracks.map((t) => {
        const mine = latest.tracks.find((x) => x.id === t.id);
        return mine && get().canEditClips(mine) ? { ...t, clips: mine.clips } : t;
      });
      for (const t of tracks) engine.setTrackClips(t.id, t.clips, { reschedule: false });
      if (fresh.bpm !== latest.bpm) engine.setBpm(fresh.bpm);
      set({
        project: { ...fresh, tracks, takes: { ...latest.takes, ...fresh.takes } },
        durationSec: engine.getProjectDurationSec(),
        takesVersion: get().takesVersion + 1,
      });
      syncMixToEngine();
    } catch (err) {
      console.error("Couldn't catch up with the latest changes:", err);
    }
  };

  // Removes recording files that no clip uses (left behind by deleted clips or
  // failed uploads), for the channels this person plays. Runs once when a song
  // opens, when nothing can be undone or mid-save. Files younger than 10
  // minutes are never touched.
  const cleanUpUnusedFiles = async (project: Project) => {
    try {
      for (const track of project.tracks) {
        if (!get().canEditClips(track)) continue;
        const used = new Set<string>();
        for (const clip of track.clips) {
          const take = project.takes[clip.takeId];
          if (take) used.add(take.storagePath.split("/").pop() ?? "");
        }
        const files = await api.listTrackFiles(project.id, track.id);
        const orphans = findOrphanFiles(files, used, Date.now());
        if (orphans.length === 0) continue;
        await api.removeTakeFiles(project.id, track.id, orphans.map((f) => f.name));
        await api.deleteTakeRows(track.id, orphans.map((f) => takeIdFromFileName(f.name)));
        console.info(`Cleaned up ${orphans.length} unused recording file(s) on "${track.instrument}".`);
      }
    } catch (err) {
      console.warn("Storage cleanup skipped:", err);
    }
  };


  // ---- Notes (internals) ----
  const sortNotes = (list: ProjectNote[]) => [...list].sort((a, b) => a.createdAt - b.createdAt);

  const nameForUser = (userId: string): string | null => {
    const { project, notes } = get();
    if (userId === currentUserId()) return useAuthStore.getState().profile?.displayName ?? null;
    const fromNote = notes.find((n) => n.authorId === userId && n.authorName)?.authorName;
    if (fromNote) return fromNote;
    if (!project) return null;
    if (project.mixerId === userId && project.mixerName) return project.mixerName;
    return project.tracks.find((t) => t.assignedUserId === userId && t.assignedPlayerName)?.assignedPlayerName ?? null;
  };

  const refreshNotes = async (projectId: string) => {
    try {
      const notes = await api.listNotes(projectId);
      if (get().project?.id === projectId) set({ notes });
    } catch (err) {
      // Before the notes migration has been run there is no table yet; the rest of the app is unaffected.
      console.warn("Couldn't load the notes:", err);
    }
  };

  const handleNoteChange = (type: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>) => {
    const project = get().project;
    if (!project) return;
    if (type === "DELETE") {
      set({ notes: get().notes.filter((n) => n.id !== row.id) });
      return;
    }
    if (row.project_id !== project.id) return;
    const authorId = row.author_id as string;
    const name = nameForUser(authorId);
    const note = api.mapNote(row, name);
    const previous = get().notes.find((n) => n.id === note.id);
    const rest = get().notes.filter((n) => n.id !== note.id);
    set({ notes: sortNotes([...rest, note]) });
    // Someone just tagged me: tell me, once.
    const uid = currentUserId();
    if (uid && authorId !== uid && !note.done && note.mentions.includes(uid) && !previous?.mentions.includes(uid)) {
      set({ noteAlert: { id: note.id, from: name ?? "Someone" } });
    }
    if (!name) {
      void api.fetchDisplayName(authorId).then((fetched) => {
        if (fetched) set({ notes: get().notes.map((n) => (n.authorId === authorId && !n.authorName ? { ...n, authorName: fetched } : n)) });
      });
    }
  };

  const startRealtime = (projectId: string) => {
    stopRealtime();
    const uid = currentUserId();
    const name = useAuthStore.getState().profile?.displayName ?? "Someone";
    const me = uid ? { userId: uid, name } : null;
    unsubscribeRealtime = subscribeToProject(projectId, {
      onPresence: (users) => set({ presentUsers: users }),
      onProject: handleProjectChange,
      onListeners: () => {
        void api
          .fetchListeners(projectId)
          .then((listeners) => {
            const current = get().project;
            if (current) set({ project: { ...current, listeners } });
          })
          .catch((err) => console.warn("Couldn't refresh the listeners:", err));
      },
      onNote: (type, row) => handleNoteChange(type, row),
      onTrack: (type, row) => void handleTrackChange(type, row),
      onClip: (type, row) => void handleClipChange(type, row),
      onStatus: (status) => {
        set({ realtimeStatus: status });
        // Connected (or reconnected): pick up anything we missed in between.
        if (status === "live") void syncFromServer();
      },
    }, me);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && get().project) void syncFromServer();
    });
  }

  return {
    project: null,
    projectLoading: false,
    projectError: null,
    engine,

    isInitiator: () => {
      const { project } = get();
      const uid = currentUserId();
      return !!project && !!uid && project.initiatorId === uid;
    },
    isParticipant: () => {
      const { project } = get();
      const uid = currentUserId();
      if (!project || !uid) return false;
      return (
        project.initiatorId === uid ||
        project.mixerId === uid ||
        project.tracks.some((t) => t.assignedUserId === uid) ||
        project.listeners.some((l) => l.userId === uid)
      );
    },
    canEditClips: (track) => {
      const uid = currentUserId();
      return !!uid && track.assignedUserId === uid;
    },
    tempoLocked: () => !!get().project?.tracks.some((t) => t.clips.length > 0),

    canMix: () => {
      const { project } = get();
      return !!project && canMixFinal(project, currentUserId());
    },
    // The Owner and the Mixer always; the channel's own player unless the channel is locked.
    canUseFx: (track) => get().canMix() || (get().canEditClips(track) && !track.fxLocked),

    roleLabel: () => {
      const { project } = get();
      if (!project) return null;
      return roleBadge(
        rolesOf(
          {
            initiatorId: project.initiatorId,
            mixerId: project.mixerId,
            listenerIds: project.listeners.map((l) => l.userId),
            assignedUserIds: project.tracks.map((t) => t.assignedUserId),
          },
          currentUserId()
        )
      );
    },

    createRoleInvite: async (role) => {
      const { project } = get();
      const uid = currentUserId();
      if (!project || !uid || !get().isInitiator()) throw new Error("Only the owner can invite people.");
      const token = await api.createProjectInvite(project.id, role, uid);
      return `${window.location.origin}/join/${token}`;
    },

    setMixer: async (userId) => {
      const { project } = get();
      if (!project || !get().isInitiator()) return;
      try {
        await api.setMixer(project.id, userId);
        // Re-read the names so the Owner sees who was picked straight away.
        const fresh = await api.getProject(project.id);
        const current = get().project;
        if (current) set({ project: { ...current, mixerId: fresh.mixerId, mixerName: fresh.mixerName, listeners: fresh.listeners } });
      } catch (err) {
        console.error("Failed to set the mixer:", err);
        set({ editError: `Couldn't set the mixer${errorDetail(err)}` });
      }
    },

    addMemberByEmail: async (email) => {
      const { project } = get();
      if (!project || !get().isInitiator()) throw new Error("Only the owner can add people.");
      const trimmed = email.trim();
      if (!trimmed) throw new Error("Type an email address first.");
      const match = await api.findProfileByEmail(trimmed);
      if (!match) throw new Error("No account yet for that email — they need to sign in once first, or send them the invite link instead.");
      await api.addProjectMember(project.id, match.id);
      const fresh = await api.getProject(project.id);
      const current = get().project;
      if (current) set({ project: { ...current, mixerId: fresh.mixerId, mixerName: fresh.mixerName, listeners: fresh.listeners } });
      return match.displayName ?? "That person";
    },

    removeListener: async (userId) => {
      const { project } = get();
      if (!project || !get().isInitiator()) return;
      try {
        await api.removeListener(project.id, userId);
        const current = get().project;
        if (current) set({ project: { ...current, listeners: current.listeners.filter((l) => l.userId !== userId) } });
      } catch (err) {
        console.error("Failed to remove the listener:", err);
        set({ editError: `Couldn't remove the listener${errorDetail(err)}` });
      }
    },

    loadProject: async (id) => {
      for (const id of Object.keys(get().fxCompare)) engine.setFxCompare(id, false);
      fxUndoStacks.clear();
      fxLastCheckpoint.clear();
      set({ projectLoading: true, projectError: null, project: null, selectedClip: null, editError: null, loop: null, loopEnabled: false, armedTrackId: null, notes: [], noteAlert: null, notesTrayOpen: false, noteCards: {}, openFlagId: null, noteChannelFilter: null, fxUndoCount: {}, fxCompare: {}, chords: {}, chordsShown: {} });
      try {
        const project = await api.getProject(id);
        await api.hydrateTakeBlobs(project);
        // Start from a clean engine so a previously opened song can't keep playing.
        engine.resetProject();
        engine.setLoop(null);
        for (const take of Object.values(project.takes)) {
          if (take.blob) await engine.loadTake(take.id, take.blob);
        }
        for (const track of project.tracks) {
          engine.setTrackClips(track.id, track.clips);
          engine.updateTrackFx(track.id, track.fx);
        }
        engine.setBpm(project.bpm);
        undoStack = [];
        redoStack = [];

        const uid = currentUserId();
        const isParticipant = project.initiatorId === uid || project.tracks.some((t) => t.assignedUserId === uid);
        set({
          project,
          positionSec: 0,
          durationSec: engine.getProjectDurationSec(),
          monitor: readMonitor(project.id),
          personalOrder: readPersonalOrder(project.id),
          personalColors: readPersonalColors(project.id),
          localSolo: {},
          // Players hear their own monitor mix; someone just listening hears the final mix.
          listeningMode: isParticipant ? "monitor" : "final",
          historyCounts: { undo: 0, redo: 0 },
          takesVersion: get().takesVersion + 1,
        });
        syncMixToEngine();
        set({ noteCards: readNoteCards(project.id) });
        void refreshNotes(project.id);
        startRealtime(project.id);
        void cleanUpUnusedFiles(project);
      } catch (err) {
        console.error("Failed to load project:", err);
        set({ projectError: err instanceof Error ? err.message : "Failed to load this song." });
      } finally {
        set({ projectLoading: false });
      }
    },

    setTempo: async (bpm) => {
      const { project } = get();
      if (!project || !get().isInitiator() || get().tempoLocked()) return;
      const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
      const previous = project.bpm;
      set({ project: { ...project, bpm: clamped }, chords: {}, chordsShown: {} });
      engine.setBpm(clamped);
      syncLoop();
      try {
        await api.setTempo(project.id, clamped);
      } catch (err) {
        console.error("Failed to change tempo:", err);
        const current = get().project;
        if (current) set({ project: { ...current, bpm: previous } });
        engine.setBpm(previous);
        set({ editError: "Couldn't change the tempo — it may be locked because the song has recordings." });
      }
    },

    renameProject: async (title) => {
      const { project } = get();
      const trimmed = title.trim();
      if (!project || !trimmed || !get().isInitiator()) return;
      set({ project: { ...project, title: trimmed } });
      await api.renameProject(project.id, trimmed);
    },

    metronomeEnabled: false,
    toggleMetronome: () => {
      const next = !get().metronomeEnabled;
      set({ metronomeEnabled: next });
      engine.setMetronomeEnabled(next);
    },
    metronomeVolume: 0.35,
    setMetronomeVolume: (volume) => {
      const clamped = Math.min(1, Math.max(0, volume));
      set({ metronomeVolume: clamped });
      engine.setMetronomeVolume(clamped);
    },
    testMetronomeClick: () => void engine.playTestClick(),
    countInEnabled: readStoredCountIn(),
    setCountInEnabled: (enabled) => {
      set({ countInEnabled: enabled });
      try {
        if (enabled) localStorage.removeItem(COUNT_IN_STORAGE_KEY);
        else localStorage.setItem(COUNT_IN_STORAGE_KEY, "off");
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    recordingTrackId: null,
    recordingPhase: "idle",
    recordingError: null,
    recordingNotice: null,
    recordingGhost: null,

    availableInputs: [],
    inputDeviceId: DEFAULT_DEVICE_ID,
    inputChannelCount: 1,
    inputChannelIndex: null,
    inputLevel: 0,
    inputPeak: 0,
    trackPeaks: {},
    trackLevels: {},
    loadingInputs: false,

    refreshInputDevices: async () => {
      set({ loadingInputs: true });
      try {
        const inputs = await listInputDevices();
        set({ availableInputs: inputs });
        const current = get().inputDeviceId;
        if (!inputs.some((d) => d.deviceId === current)) {
          const fallback = inputs[0]?.deviceId ?? DEFAULT_DEVICE_ID;
          await get().setInputDevice(fallback);
        } else {
          const count = await probeChannelCount(current);
          set({ inputChannelCount: count });
          startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
        }
      } finally {
        set({ loadingInputs: false });
      }
    },

    setInputDevice: async (deviceId) => {
      set({ inputDeviceId: deviceId, inputChannelIndex: null, inputChannelCount: 1 });
      const count = await probeChannelCount(deviceId);
      if (get().inputDeviceId !== deviceId) return;
      set({ inputChannelCount: count });
      try {
        await startInputMeter();
      } catch (err) {
        console.error("Could not start input monitoring:", err);
      }
    },

    setInputChannel: (channelIndex) => {
      set({ inputChannelIndex: channelIndex });
      startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
    },

    availableOutputs: [],
    outputDeviceId: DEFAULT_DEVICE_ID,
    metronomeOutputDeviceId: null,
    masterOutputRoutingSupported: engine.isMasterOutputRoutingSupported(),
    metronomeOutputRoutingSupported: engine.isMetronomeOutputRoutingSupported(),
    loadingOutputs: false,

    refreshOutputDevices: async () => {
      set({ loadingOutputs: true });
      try {
        const outputs = await listOutputDevices();
        set({ availableOutputs: outputs });
        // Listing devices alone doesn't route audio anywhere — without this,
        // "Default" just showed as selected while the audio context stayed on
        // whatever (possibly silent) device it happened to bind to when it
        // was created, and nothing played until you reselected a device by
        // hand (the only other place that calls setOutputDevice). Applying it
        // here, every time, makes the shown selection the one actually in use.
        const current = get().outputDeviceId;
        const target = outputs.some((d) => d.deviceId === current) ? current : (outputs[0]?.deviceId ?? current);
        await get().setOutputDevice(target);
      } finally {
        set({ loadingOutputs: false });
      }
    },

    setOutputDevice: async (deviceId) => {
      set({ outputDeviceId: deviceId });
      // The click follows the main output automatically when it's set to
      // "same as main" (it's wired straight to the same destination).
      await engine.setOutputDevice(deviceId);
    },

    setMetronomeOutputDevice: async (deviceId) => {
      set({ metronomeOutputDeviceId: deviceId });
      await engine.setMetronomeOutputDevice(deviceId);
    },

    latencyCompMs: initialLatencyMs,
    estimatedLatencyMs: 0,
    calibrationState: "idle",
    calibrationMessage: null,

    setLatencyCompMs: (ms) => {
      const clean = ms === null || !Number.isFinite(ms) ? null : Math.max(0, Math.min(500, Math.round(ms)));
      set({ latencyCompMs: clean, calibrationState: "idle", calibrationMessage: null });
      engine.setLatencyCompensationSec(clean === null ? null : clean / 1000);
      try {
        if (clean === null) localStorage.removeItem(LATENCY_STORAGE_KEY);
        else localStorage.setItem(LATENCY_STORAGE_KEY, String(clean));
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },

    refreshEstimatedLatency: () => set({ estimatedLatencyMs: Math.round(engine.estimateLatencySec() * 1000) }),

    calibrateLatency: async () => {
      if (get().calibrationState === "running" || get().recordingTrackId) return;
      set({ calibrationState: "running", calibrationMessage: null });
      try {
        const result = await engine.measureRoundTripLatency(get().inputDeviceId, get().inputChannelIndex);
        if (result.latencySec === null) {
          set({ calibrationState: "failed", calibrationMessage: result.reason });
          return;
        }
        const ms = Math.round(result.latencySec * 1000);
        get().setLatencyCompMs(ms);
        set({ calibrationState: "done", calibrationMessage: `Measured ${ms} ms round-trip delay — it will now be corrected on every take.` });
      } catch (err) {
        console.error("Latency calibration failed:", err);
        set({ calibrationState: "failed", calibrationMessage: "Calibration couldn't run — check microphone access and try again." });
      }
    },

    settingsOpen: false,
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),

    addTrack: async (instrument) => {
      const { project } = get();
      // Anyone already in the song may add a new channel; only the Owner invites a
      // player to it (see createInvite).
      if (!project || !get().isParticipant()) return;
      const color = TRACK_COLORS[project.tracks.length % TRACK_COLORS.length];
      const position = project.tracks.reduce((max, t) => Math.max(max, t.position), -1) + 1;
      // Everyone except the Owner plays the channel they add (the Owner often sets channels up for others).
      const uid = currentUserId();
      const mine = !get().isInitiator() && uid ? uid : null;
      const myName = useAuthStore.getState().profile?.displayName ?? null;
      try {
        const track = await api.addTrack(project.id, instrument, color, position, mine, myName);
        // Read the song again: a live change may have arrived while we were saving.
        const latest = get().project;
        if (!latest || latest.tracks.some((t) => t.id === track.id)) return;
        set({ project: { ...latest, tracks: [...latest.tracks, track] } });
        syncMixToEngine();
      } catch (err) {
        console.error("Failed to add channel:", err);
        set({ editError: `Couldn't add that channel${errorDetail(err)}` });
      }
    },

    removeTrack: async (trackId) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track || !get().isInitiator()) return;
      // A channel with recordings is never removed; delete the clips first.
      if (track.clips.length > 0) return;
      try {
        // Clear leftover recording files of this (empty) channel first; best effort.
        try {
          const files = await api.listTrackFiles(project.id, trackId);
          await api.removeTakeFiles(project.id, trackId, files.map((f) => f.name));
        } catch (err) {
          console.warn("Could not clear the channel's files:", err);
        }
        await api.removeTrack(trackId);
      } catch (err) {
        console.error("Failed to remove channel:", err);
        set({ editError: `Couldn't remove that channel${errorDetail(err)}` });
        return;
      }
      engine.removeTrack(trackId);
      const current = get().project;
      if (!current) return;
      set({ project: { ...current, tracks: current.tracks.filter((t) => t.id !== trackId) }, durationSec: engine.getProjectDurationSec() });
    },

    personalColors: {},
    setTrackColor: async (trackId, color) => {
      const { project } = get();
      if (!project) return;
      if (!get().isInitiator()) {
        const next = { ...get().personalColors, [trackId]: color };
        try {
          localStorage.setItem(colorsKey(project.id), JSON.stringify(next));
        } catch {
          // Not being able to remember it is fine.
        }
        set({ personalColors: next });
        return;
      }
      const before = project.tracks;
      set({ project: { ...project, tracks: before.map((t) => (t.id === trackId ? { ...t, color } : t)) } });
      try {
        await api.updateTrackColor(trackId, color);
      } catch (err) {
        console.error("Failed to save the colour:", err);
        const current = get().project;
        if (current) set({ project: { ...current, tracks: before }, editError: `Couldn't save the colour${errorDetail(err)}` });
      }
    },

    renameTrack: async (trackId, instrument) => {
      const { project } = get();
      const trimmed = instrument.trim();
      if (!project || !trimmed || !get().isParticipant()) return;
      const before = project.tracks;
      set({ project: { ...project, tracks: before.map((t) => (t.id === trackId ? { ...t, instrument: trimmed } : t)) } });
      try {
        await api.updateTrackInstrument(trackId, trimmed);
      } catch (err) {
        console.error("Failed to rename the channel:", err);
        const current = get().project;
        if (current) set({ project: { ...current, tracks: before }, editError: `Couldn't rename that channel${errorDetail(err)}` });
      }
    },

    personalOrder: null,
    moveTrack: async (trackId, toIndex) => {
      const { project } = get();
      if (!project) return;
      const initiator = get().isInitiator();
      const shown = orderTracks(project.tracks, initiator ? null : get().personalOrder).map((t) => t.id);
      const from = shown.indexOf(trackId);
      if (from < 0 || from === toIndex) return;
      const next = moveId(shown, from, toIndex);

      if (!initiator) {
        writePersonalOrder(project.id, next);
        set({ personalOrder: next });
        return;
      }
      // The initiator's arrangement is the song's default, saved for everyone.
      const before = project.tracks;
      set({ project: { ...project, tracks: before.map((t) => ({ ...t, position: next.indexOf(t.id) })) } });
      try {
        await api.setTrackOrder(next);
      } catch (err) {
        console.error("Failed to save the channel order:", err);
        const current = get().project;
        if (current) set({ project: { ...current, tracks: before }, editError: `Couldn't save the channel order${errorDetail(err)}` });
      }
    },
    resetOrder: () => {
      const { project } = get();
      if (!project) return;
      writePersonalOrder(project.id, null);
      set({ personalOrder: null });
    },

    claimChannel: async (trackId) => {
      const { project } = get();
      const uid = currentUserId();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !uid || !track || track.assignedUserId || !get().isInitiator()) return;
      try {
        await api.claimOwnTrack(trackId);
      } catch (err) {
        console.error("Failed to take the channel:", err);
        set({ editError: "Couldn't take that channel — has the database update been applied?" });
        return;
      }
      const name = useAuthStore.getState().profile?.displayName ?? null;
      const current = get().project;
      if (!current) return;
      set({
        project: {
          ...current,
          tracks: current.tracks.map((t) => (t.id === trackId ? { ...t, assignedUserId: uid, assignedPlayerName: name } : t)),
        },
      });
    },

    reassignTrack: async (trackId, userId) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track || track.clips.length > 0 || !get().isInitiator()) return;
      await api.reassignTrack(trackId, userId);
      const fresh = await api.getProject(project.id);
      const current = get().project;
      if (current) set({ project: { ...current, tracks: fresh.tracks } });
    },

    assignTrackToUser: async (trackId, userId) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track || !get().isInitiator()) return;
      if (track.assignedUserId) return get().reassignTrack(trackId, userId);
      await api.assignTrackToUser(trackId, userId);
      // Re-read so the assigned player's name comes back joined, like setMixer does.
      const fresh = await api.getProject(project.id);
      const current = get().project;
      if (current) set({ project: { ...current, tracks: fresh.tracks } });
    },

    assignTrackByEmail: async (trackId, email) => {
      const trimmed = email.trim();
      if (!trimmed) return;
      const match = await api.findProfileByEmail(trimmed);
      if (!match) {
        throw new Error("No account yet for that email — they need to sign in once first, or use the invite link instead.");
      }
      await get().assignTrackToUser(trackId, match.id);
    },

    // ---- Mixing -------------------------------------------------------------

    listeningMode: "monitor",
    monitor: {},
    localSolo: {},

    setListeningMode: (mode) => {
      if (get().canMix()) return; // the Owner and the Mixer always hear (and edit) the final mix
      set({ listeningMode: mode });
      syncMixToEngine();
    },

    canAdjustMix: () => get().canMix() || get().listeningMode === "monitor",

    effectiveMix: (track) =>
      effectiveChannelMix({
        saved: track,
        canMix: get().canMix(),
        listeningMode: get().listeningMode,
        personal: get().monitor[track.id],
        solo: !!get().localSolo[track.id],
      }),

    setChannelVolume: (trackId, volume) => {
      const { project } = get();
      if (!project) return;
      const v = Math.min(2.01, Math.max(0, volume));
      if (get().canMix()) {
        set({ project: { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, volume: v } : t)) } });
        syncMixToEngine();
        scheduleMixSave(trackId, { volume: v });
      } else if (get().listeningMode === "monitor") {
        const monitor = { ...get().monitor, [trackId]: { volume: v, muted: get().monitor[trackId]?.muted ?? false } };
        set({ monitor });
        writeMonitor(project.id, monitor);
        syncMixToEngine();
      }
    },

    setChannelPan: (trackId, pan) => {
      const { project } = get();
      if (!project || !get().canMix()) return;
      const p = Math.min(1, Math.max(-1, pan));
      set({ project: { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, pan: p } : t)) } });
      syncMixToEngine();
      scheduleMixSave(trackId, { pan: p });
    },
    toggleChannelMute: (trackId) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track) return;
      if (get().canMix()) {
        const muted = !track.muted;
        set({ project: { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)) } });
        syncMixToEngine();
        scheduleMixSave(trackId, { muted });
      } else if (get().listeningMode === "monitor") {
        const current = get().monitor[trackId];
        const monitor = { ...get().monitor, [trackId]: { volume: current?.volume ?? 1, muted: !(current?.muted ?? false) } };
        set({ monitor });
        writeMonitor(project.id, monitor);
        syncMixToEngine();
      }
    },

    loop: null,
    loopEnabled: false,
    setLoopRegion: (startBeat, endBeat) => {
      const start = Math.max(0, Math.min(startBeat, endBeat));
      const end = Math.max(startBeat, endBeat);
      if (end - start < 0.25) return;
      // Drawing a region turns the loop on, as in a DAW.
      set({ loop: { startBeat: start, endBeat: end }, loopEnabled: true });
      syncLoop();
    },
    toggleLoop: () => {
      const { project, loop, loopEnabled, selectedClip, positionSec } = get();
      if (!project) return;
      if (!loop) {
        // First time: use the selected clip, otherwise four bars from the bar the playhead is in.
        const track = project.tracks.find((t) => t.id === selectedClip?.trackId);
        const clip = track?.clips.find((c) => c.id === selectedClip?.clipId);
        const beat = beatSec(project.bpm);
        if (clip) set({ loop: { startBeat: clip.startSec / beat, endBeat: clipEndSec(clip) / beat }, loopEnabled: true });
        else {
          const startBeat = Math.floor(positionSec / beat / BEATS_PER_BAR) * BEATS_PER_BAR;
          set({ loop: { startBeat, endBeat: startBeat + 4 * BEATS_PER_BAR }, loopEnabled: true });
        }
      } else {
        set({ loopEnabled: !loopEnabled });
      }
      syncLoop();
    },

    setAllMuted: (muted) => {
      const { project } = get();
      if (!project) return;
      if (get().canMix()) {
        set({ project: { ...project, tracks: project.tracks.map((t) => ({ ...t, muted })) } });
        syncMixToEngine();
        for (const t of project.tracks) if (t.muted !== muted) scheduleMixSave(t.id, { muted });
      } else if (get().listeningMode === "monitor") {
        const monitor = { ...get().monitor };
        for (const t of project.tracks) monitor[t.id] = { volume: monitor[t.id]?.volume ?? 1, muted };
        set({ monitor });
        writeMonitor(project.id, monitor);
        syncMixToEngine();
      }
    },
    clearSolo: () => {
      set({ localSolo: {} });
      syncMixToEngine();
    },

    armedTrackId: null,
    // Clicking the already-armed channel's dot turns recording off again.
    // Arming starts a silent level meter on the current input device (so the
    // signal lights work right away); unarming stops it unless a recording
    // is already under way, which keeps the mic open itself.
    armTrack: (trackId) => {
      const next = get().armedTrackId === trackId ? null : trackId;
      set({ armedTrackId: next });
      if (next) {
        startInputMeter().catch((err) => {
          console.error("Could not start input monitoring:", err);
          set({ editError: `Couldn't read the microphone for the signal lights${errorDetail(err)}` });
        });
      } else {
        stopInputMeterIfIdle();
      }
    },
    // Nothing is armed until you choose a channel — like a real console, Record
    // is off by default rather than picking a channel for you.
    effectiveArmedId: () => {
      const { project, armedTrackId } = get();
      if (!project || !armedTrackId) return null;
      const track = project.tracks.find((t) => t.id === armedTrackId);
      return track && get().canEditClips(track) ? armedTrackId : null;
    },
    toggleRecord: () => {
      const { recordingPhase, recordingTrackId } = get();
      if (recordingTrackId && recordingPhase !== "uploading") {
        void get().stopRecording();
        return;
      }
      const id = get().effectiveArmedId();
      if (id && !recordingTrackId) void get().startRecording(id);
    },

    // Solo is a listening aid for whoever presses it. It is never saved to the song.
    toggleChannelSolo: (trackId) => {
      set({ localSolo: { ...get().localSolo, [trackId]: !get().localSolo[trackId] } });
      syncMixToEngine();
    },

    // Owner/Mixer only — EQ, Compressor, Delay and Reverb on the saved final mix.
    setChannelFx: (trackId, patch, opts) => {
      const { project } = get();
      if (!project) return;
      const track = project.tracks.find((t) => t.id === trackId);
      if (!track || !get().canUseFx(track)) return;
      // A knob drag is many small changes: it counts as one undo step, started when the drag begins.
      const now = Date.now();
      if (opts?.checkpoint || now - (fxLastCheckpoint.get(trackId) ?? 0) > 1200) {
        const stack = fxUndoStacks.get(trackId) ?? [];
        stack.push(track.fx);
        if (stack.length > 40) stack.shift();
        fxUndoStacks.set(trackId, stack);
        set({ fxUndoCount: { ...get().fxUndoCount, [trackId]: stack.length } });
      }
      fxLastCheckpoint.set(trackId, now);
      applyFxNow(trackId, patch);
    },

    fxUndoCount: {},
    undoChannelFx: (trackId) => {
      const track = get().project?.tracks.find((t) => t.id === trackId);
      const stack = fxUndoStacks.get(trackId);
      if (!track || !stack?.length || !get().canUseFx(track)) return;
      const previous = stack.pop()!;
      fxLastCheckpoint.set(trackId, 0);
      set({ fxUndoCount: { ...get().fxUndoCount, [trackId]: stack.length } });
      applyFxNow(trackId, previous);
    },
    resetChannelFx: (trackId) => {
      const track = get().project?.tracks.find((t) => t.id === trackId);
      if (!track) return;
      get().setChannelFx(trackId, resetPatch(track.fx), { checkpoint: true });
    },
    applyFxPreset: (trackId, presetId) => {
      const patch = presetPatch(presetId);
      const track = get().project?.tracks.find((t) => t.id === trackId);
      if (!patch || !track) return;
      // A preset sets the effects but keeps which ones the player has bypassed.
      get().setChannelFx(trackId, { ...patch, eqOn: track.fx.eqOn, compOn: track.fx.compOn, delayOn: track.fx.delayOn, reverbOn: track.fx.reverbOn }, { checkpoint: true });
    },
    fxCompare: {},
    setFxCompare: (trackId, dry) => {
      engine.setFxCompare(trackId, dry);
      set({ fxCompare: { ...get().fxCompare, [trackId]: dry } });
    },
    setFxLocked: (trackId, locked) => {
      const project = get().project;
      if (!project || !get().canMix()) return;
      const before = project.tracks.find((t) => t.id === trackId)?.fxLocked ?? false;
      const apply = (value: boolean) => {
        const latest = get().project;
        if (latest) set({ project: { ...latest, tracks: latest.tracks.map((t) => (t.id === trackId ? { ...t, fxLocked: value } : t)) } });
      };
      apply(locked);
      api.setTrackFxLocked(trackId, locked).catch((err) => {
        console.error("Failed to lock the effects:", err);
        apply(before);
        set({ editError: `Couldn't ${locked ? "lock" : "unlock"} that channel's effects${errorDetail(err)}` });
      });
    },

    // ---- Clip editing ---------------------------------------------------------

    pxPerBeat: 28,
    setPxPerBeat: (pxPerBeat) => set({ pxPerBeat: Math.min(120, Math.max(8, pxPerBeat)) }),
    followPlayhead: readStoredFollow(),
    setFollowPlayhead: (follow) => {
      set({ followPlayhead: follow });
      try {
        if (follow) localStorage.removeItem(FOLLOW_KEY);
        else localStorage.setItem(FOLLOW_KEY, "off");
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    snapEnabled: readStoredSnapEnabled(),
    snapResolution: readStoredSnapResolution(),
    setSnapEnabled: (enabled) => {
      set({ snapEnabled: enabled });
      try {
        if (enabled) localStorage.removeItem(SNAP_ENABLED_KEY);
        else localStorage.setItem(SNAP_ENABLED_KEY, "off");
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    setSnapResolution: (resolution) => {
      set({ snapResolution: resolution });
      try {
        localStorage.setItem(SNAP_RESOLUTION_KEY, resolution);
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },

    selectedClip: null,
    selectClip: (selection) => set({ selectedClip: selection }),
    historyCounts: { undo: 0, redo: 0 },
    takesVersion: 0,
    editError: null,

    commitClips: async (trackId, next, opts = {}) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track || !get().canEditClips(track)) return false;

      const before = track.clips;
      const beforeById = new Map(before.map((c) => [c.id, c]));
      const nextIds = new Set(next.map((c) => c.id));
      const removed = before.filter((c) => !nextIds.has(c.id)).map((c) => c.id);
      const changed = next.filter((c) => {
        const old = beforeById.get(c.id);
        return !old || !sameClip(old, c);
      });
      if (removed.length === 0 && changed.length === 0) return true;

      const after = [...next].sort((a, b) => a.z - b.z);
      applyTrackClips(trackId, after);
      if (!opts.skipHistory) {
        undoStack.push({ trackId, before, after });
        redoStack = [];
        updateHistoryCounts();
      }

      try {
        // Write new/changed first, delete last: a failure part-way never loses audio.
        await api.upsertClips(trackId, changed);
        await api.deleteClips(removed);
        set({ editError: null });
        return true;
      } catch (err) {
        console.error("Failed to save clip edit:", err);
        applyTrackClips(trackId, before);
        if (!opts.skipHistory) {
          undoStack.pop();
          updateHistoryCounts();
        }
        set({ editError: `Couldn't save that change, so it was undone${errorDetail(err)}` });
        return false;
      }
    },

    splitSelected: async () => {
      const { project, selectedClip } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      const clip = track?.clips.find((c) => c.id === selectedClip?.clipId);
      if (!project || !track || !clip) return;
      const parts = splitClip(clip, get().positionSec, crypto.randomUUID());
      if (!parts) return;
      await get().commitClips(track.id, [...track.clips.filter((c) => c.id !== clip.id), parts[0], parts[1]]);
    },

    duplicateSelected: async () => {
      const { project, selectedClip } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      const clip = track?.clips.find((c) => c.id === selectedClip?.clipId);
      if (!project || !track || !clip) return;
      const copy = duplicateClip(clip, crypto.randomUUID(), nextZ(track.clips));
      if (await get().commitClips(track.id, [...track.clips, copy])) set({ selectedClip: { trackId: track.id, clipId: copy.id } });
    },

    deleteSelected: async () => {
      const { project, selectedClip } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      if (!project || !track || !selectedClip) return;
      await get().commitClips(track.id, track.clips.filter((c) => c.id !== selectedClip.clipId));
    },

    // Arrow keys: one grid step (or 10 ms with snapping off). Alt+arrow: 1 ms.
    nudgeSelected: async (direction, fine) => {
      const { project, selectedClip, snapEnabled, snapResolution } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      const clip = track?.clips.find((c) => c.id === selectedClip?.clipId);
      if (!project || !track || !clip) return;

      let start: number;
      if (fine) {
        start = clip.startSec + direction * 0.001;
      } else if (snapEnabled) {
        const step = stepSec(project.bpm, snapResolution);
        start = direction > 0 ? (Math.floor(clip.startSec / step + 1e-6) + 1) * step : (Math.ceil(clip.startSec / step - 1e-6) - 1) * step;
      } else {
        start = clip.startSec + direction * 0.01;
      }
      await get().commitClips(track.id, track.clips.map((c) => (c.id === clip.id ? moveClip(c, start) : c)));
    },

    undo: async () => {
      const entry = undoStack.pop();
      if (!entry) return;
      updateHistoryCounts();
      const ok = await get().commitClips(entry.trackId, entry.before, { skipHistory: true });
      (ok ? redoStack : undoStack).push(entry);
      updateHistoryCounts();
    },

    redo: async () => {
      const entry = redoStack.pop();
      if (!entry) return;
      updateHistoryCounts();
      const ok = await get().commitClips(entry.trackId, entry.after, { skipHistory: true });
      (ok ? undoStack : redoStack).push(entry);
      updateHistoryCounts();
    },

    play: () => {
      engine.resume().then(() => engine.play(get().positionSec));
    },

    chords: {},
    chordsShown: {},
    detectingChords: null,
    toggleChords: async (trackId) => {
      const { project, chords, chordsShown } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track) return;
      if (chords[trackId]) {
        set({ chordsShown: { ...chordsShown, [trackId]: !chordsShown[trackId] } });
        return;
      }
      if (get().detectingChords) return;
      set({ detectingChords: trackId });
      try {
        const found: ChordSegment[] = [];
        for (const seg of audibleSegments(track.clips)) {
          const buffer = engine.getTakeBuffer(seg.takeId);
          if (!buffer) continue;
          // Let the screen breathe between recordings: the analysis is a second or two of number crunching.
          await new Promise((r) => setTimeout(r, 0));
          found.push(
            ...detectChords(buffer.getChannelData(0), buffer.sampleRate, project.bpm, {
              timelineStartSec: seg.startSec,
              sourceStartSec: seg.sourceStartSec,
              durationSec: seg.endSec - seg.startSec,
            })
          );
        }
        found.sort((a, b) => a.startBeat - b.startBeat);
        if (get().project?.id !== project.id) return;
        set({ chords: { ...get().chords, [trackId]: found }, chordsShown: { ...get().chordsShown, [trackId]: true } });
      } catch (err) {
        console.error("Failed to detect the chords:", err);
        set({ editError: `Couldn't work out the chords${errorDetail(err)}` });
      } finally {
        set({ detectingChords: null });
      }
    },

    notes: [],
    notesVisible: readNotesVisible(),
    setNotesVisible: (visible) => {
      set({ notesVisible: visible });
      try {
        if (visible) localStorage.setItem(NOTES_VISIBLE_KEY, "on");
        else localStorage.removeItem(NOTES_VISIBLE_KEY);
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    notesTrayOpen: false,
    setNotesTrayOpen: (open) => set({ notesTrayOpen: open }),
    noteAlert: null,
    dismissNoteAlert: () => set({ noteAlert: null }),
    openNoteAlert: () => {
      get().setNotesVisible(true);
      set({ notesTrayOpen: true, noteChannelFilter: null, noteAlert: null });
    },
    noteCards: {},
    floatNote: (id) => {
      const project = get().project;
      if (!project || get().noteCards[id]) return;
      const count = Object.keys(get().noteCards).length;
      const next = { ...get().noteCards, [id]: { x: 80 + count * 28, y: 150 + count * 28, min: false } };
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    moveNoteCard: (id, x, y) => {
      const project = get().project;
      const card = get().noteCards[id];
      if (!project || !card) return;
      const next = { ...get().noteCards, [id]: { ...card, x, y } };
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    minimizeNoteCard: (id, min) => {
      const project = get().project;
      const card = get().noteCards[id];
      if (!project || !card) return;
      const next = { ...get().noteCards, [id]: { ...card, min } };
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    unfloatNote: (id) => {
      const project = get().project;
      if (!project) return;
      const next = { ...get().noteCards };
      delete next[id];
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    openFlagId: null,
    setOpenFlag: (id) => set({ openFlagId: id }),
    noteChannelFilter: null,
    showChannelNotes: (trackId) => set({ noteChannelFilter: trackId, notesVisible: true, notesTrayOpen: true }),
    canWriteNotes: () => {
      const { project } = get();
      const uid = currentUserId();
      if (!project || !uid) return false;
      return project.initiatorId === uid || project.mixerId === uid || project.tracks.some((t) => t.assignedUserId === uid);
    },
    addNote: async ({ body, atBeat, trackId, mentions, sharedWithListeners }) => {
      const { project } = get();
      const uid = currentUserId();
      const text = body.trim();
      if (!project || !uid || !text || !get().canWriteNotes()) return;
      try {
        const id = await api.createNote({ projectId: project.id, authorId: uid, body: text.slice(0, 2000), atBeat, trackId, mentions, sharedWithListeners });
        // The live update may already have added it.
        if (!get().notes.some((n) => n.id === id)) {
          const note: ProjectNote = {
            id,
            projectId: project.id,
            authorId: uid,
            authorName: useAuthStore.getState().profile?.displayName ?? null,
            body: text.slice(0, 2000),
            atBeat,
            trackId,
            mentions,
            sharedWithListeners,
            done: false,
            doneBy: null,
            createdAt: Date.now(),
          };
          set({ notes: sortNotes([...get().notes, note]) });
        }
      } catch (err) {
        console.error("Failed to add the note:", err);
        set({ editError: `Couldn't save that note${errorDetail(err)}` });
      }
    },
    editNote: async (id, patch) => {
      const before = get().notes;
      set({ notes: before.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
      try {
        await api.updateNote(id, patch);
      } catch (err) {
        console.error("Failed to edit the note:", err);
        set({ notes: before, editError: `Couldn't save that change to the note${errorDetail(err)}` });
      }
    },
    setNoteDone: async (id, done) => {
      const before = get().notes;
      const uid = currentUserId();
      set({ notes: before.map((n) => (n.id === id ? { ...n, done, doneBy: done ? uid : null } : n)), openFlagId: done ? null : get().openFlagId });
      try {
        await api.updateNote(id, { done });
      } catch (err) {
        console.error("Failed to update the note:", err);
        set({ notes: before, editError: `Couldn't update that note${errorDetail(err)}` });
      }
    },
    removeNote: async (id) => {
      const before = get().notes;
      set({ notes: before.filter((n) => n.id !== id) });
      get().unfloatNote(id);
      try {
        await api.deleteNote(id);
      } catch (err) {
        console.error("Failed to delete the note:", err);
        set({ notes: before, editError: `Couldn't delete that note${errorDetail(err)}` });
      }
    },
    jumpToNote: (id) => {
      const { project, notes } = get();
      const note = notes.find((n) => n.id === id);
      if (!project || !note || note.atBeat === null) return;
      engine.seek(note.atBeat * beatSec(project.bpm));
    },

    realtimeStatus: "off",
    presentUsers: [],
    leaveProject: () => {
      engine.pause();
      engine.stopMonitoring();
      stopRealtime();
      set({ realtimeStatus: "off", presentUsers: [], armedTrackId: null, fxUndoCount: {}, fxCompare: {}, notes: [], noteAlert: null, notesTrayOpen: false, noteCards: {}, openFlagId: null });
    },

    pause: () => engine.pause(),
    seek: (sec) => engine.seek(sec),

    importingTrackId: null,
    importAudioFile: async (trackId, file, atSec) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      const uid = currentUserId();
      if (!project || !track || !uid || !get().canEditClips(track)) return;
      if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|ogg|flac|aiff?)$/i.test(file.name)) {
        set({ editError: `"${file.name}" doesn't look like an audio file.` });
        return;
      }

      set({ importingTrackId: trackId, editError: null });
      try {
        const arrayBuffer = await file.arrayBuffer();
        // A short-lived context just for decoding — the engine's own context
        // stays untouched until the take is ready to place.
        const decodeCtx = new AudioContext();
        let buffer: AudioBuffer;
        try {
          buffer = await decodeCtx.decodeAudioData(arrayBuffer);
        } finally {
          await decodeCtx.close();
        }
        // Re-encoded as 32-bit float WAV so every take in the song is the same
        // lossless format, whatever the dropped file originally was — but that
        // makes long files huge (a minute of mono 48kHz is ~11.5 MB), easily
        // past Supabase's per-file storage limit. Better to say so plainly
        // than let the upload fail with a raw storage error.
        const blob = encodeWavFloat32(buffer);
        if (blob.size > MAX_IMPORT_BYTES) {
          const maxMinutes = (MAX_IMPORT_BYTES / (blob.size / buffer.duration) / 60).toFixed(1);
          set({
            editError: `"${file.name}" is too long at full quality (about ${Math.round(blob.size / 1024 / 1024)} MB) — this channel can take roughly ${maxMinutes} minutes at a time. Try a shorter clip.`,
          });
          return;
        }

        const take = await api.createTake({ projectId: project.id, trackId, blob, durationSec: buffer.duration, userId: uid });
        await engine.loadTake(take.id, blob);

        const existing = get().project?.tracks.find((t) => t.id === trackId)?.clips ?? [];
        const clip: Clip = {
          id: crypto.randomUUID(),
          takeId: take.id,
          startSec: Math.max(0, atSec),
          sourceStartSec: 0,
          durationSec: buffer.duration,
          z: nextZ(existing),
        };
        await api.upsertClips(trackId, [clip]);

        const current = get().project;
        if (!current) return;
        const next = [...existing, clip];
        undoStack.push({ trackId, before: existing, after: next });
        redoStack = [];
        set({
          project: { ...current, takes: { ...current.takes, [take.id]: take } },
          takesVersion: get().takesVersion + 1,
          selectedClip: { trackId, clipId: clip.id },
        });
        applyTrackClips(trackId, next);
        updateHistoryCounts();
      } catch (err) {
        console.error("Failed to import audio file:", err);
        set({ editError: `Couldn't add "${file.name}"${errorDetail(err)}` });
      } finally {
        set({ importingTrackId: null });
      }
    },

    startRecording: async (trackId) => {
      const { project } = get();
      if (!project) return;
      const track = project.tracks.find((t) => t.id === trackId);
      if (!track || !get().canEditClips(track)) return;

      set({ recordingTrackId: trackId, recordingPhase: "requesting-mic", recordingError: null });

      try {
        await engine.resume();
        const resolvedDeviceId = await resolveInputDeviceId(get().inputDeviceId);
        await engine.startRecording(resolvedDeviceId, get().inputChannelIndex);
        const mismatch = engine.getCaptureRateMismatch();
        if (mismatch) {
          const khz = (hz: number) => `${Math.round(hz / 100) / 10} kHz`;
          set({
            recordingNotice: `Your microphone runs at ${khz(mismatch.inputHz)} and your computer's audio at ${khz(mismatch.contextHz)}. For the cleanest recording, give both the same sample rate in your sound settings, then reload.`,
          });
        } else if (get().recordingNotice) {
          set({ recordingNotice: null });
        }
      } catch (err) {
        console.error("Could not start recording:", err);
        if (get().recordingTrackId === trackId) {
          set({
            recordingTrackId: null,
            recordingPhase: "idle",
            recordingError: "Microphone access was denied or unavailable.",
          });
        }
        return;
      }

      if (get().recordingTrackId !== trackId) {
        await engine.stopRecording();
        return;
      }

      // Recording is armed and capturing. Start playback — with a 4-click
      // count-in first when enabled — then flip to "recording" the moment the
      // song position actually starts moving (that's when the take begins).
      const { startsInSec, countInSec } = engine.play(get().positionSec, {
        countInBeats: get().countInEnabled ? COUNT_IN_BEATS : 0,
      });
      if (countInSec > 0) {
        set({ recordingPhase: "count-in" });
        clearCountInTimer();
        countInTimer = setTimeout(() => {
          countInTimer = null;
          if (get().recordingTrackId === trackId && get().recordingPhase === "count-in") {
            set({ recordingPhase: "recording" });
          }
        }, startsInSec * 1000);
      } else {
        set({ recordingPhase: "recording" });
      }
    },

    stopRecording: async () => {
      const { project, recordingTrackId, recordingPhase } = get();
      if (!recordingTrackId || !project) return;
      clearCountInTimer();

      if (recordingPhase === "requesting-mic") {
        set({ recordingTrackId: null, recordingPhase: "idle" });
        return;
      }

      const live = recordingPhase === "recording" ? engine.getLiveRecording() : null;
      engine.pause();
      let result: RecordingResult;
      try {
        result = await engine.stopRecording();
      } catch (err) {
        console.error("Failed to stop recording cleanly:", err);
        result = { blob: new Blob(), timelineOffsetSec: 0, latencySec: 0, durationSec: 0 };
      }
      const { blob } = result;

      const uid = currentUserId();
      if (blob.size === 0 || !uid) {
        set({ recordingTrackId: null, recordingPhase: "idle" });
        return;
      }

      const ghost: RecordingGhost | null = live
        ? {
            trackId: recordingTrackId,
            startSec: live.startSec,
            durationSec: live.dataSec,
            binSec: live.binSec,
            peaks: live.peaks.slice(),
            target: null,
          }
        : null;
      set({ recordingPhase: "uploading", recordingGhost: ghost });
      try {
        const take = await api.createTake({
          projectId: project.id,
          trackId: recordingTrackId,
          blob,
          durationSec: result.durationSec,
          userId: uid,
        });
        await engine.loadTake(take.id, blob);

        // Every recording becomes a clip, placed where it was actually played
        // (start position + latency compensation) and stacked on top.
        const existing = get().project?.tracks.find((t) => t.id === recordingTrackId)?.clips ?? [];
        const clip: Clip = {
          id: crypto.randomUUID(),
          takeId: take.id,
          startSec: result.timelineOffsetSec,
          sourceStartSec: 0,
          durationSec: result.durationSec,
          z: nextZ(existing),
        };
        await api.upsertClips(recordingTrackId, [clip]);

        const current = get().project;
        if (!current) return;
        const next = [...existing, clip];
        undoStack.push({ trackId: recordingTrackId, before: existing, after: next });
        redoStack = [];
        set({
          project: { ...current, takes: { ...current.takes, [take.id]: take } },
          recordingTrackId: null,
          recordingPhase: "idle",
          takesVersion: get().takesVersion + 1,
          selectedClip: { trackId: recordingTrackId, clipId: clip.id },
        });
        if (ghost) {
          const landing: RecordingGhost = { ...ghost, target: { startSec: clip.startSec, durationSec: clip.durationSec } };
          set({ recordingGhost: landing });
          window.setTimeout(() => {
            if (get().recordingGhost === landing) set({ recordingGhost: null });
          }, GHOST_SETTLE_MS + 200);
        }
        applyTrackClips(recordingTrackId, next);
        updateHistoryCounts();
      } catch (err) {
        console.error("Failed to save the take:", err);
        set({
          recordingGhost: null,
          recordingTrackId: null,
          recordingPhase: "idle",
          recordingError: "Could not save that take — please try recording again.",
        });
      }
    },

    createInvite: async (trackId) => {
      const { project } = get();
      const uid = currentUserId();
      if (!project || !uid || !get().isInitiator()) throw new Error("Only the initiator can invite players.");
      const token = await api.createTrackInvite(trackId, uid);
      return `${window.location.origin}/invite/${token}`;
    },

    publish: async () => {
      const { project } = get();
      if (!project || !get().isInitiator()) return;
      await api.publishProject(project.id);
      set({ project: { ...project, status: "published", publishedAt: Date.now() } });
    },

    setProjectCover: async (file) => {
      const { project } = get();
      if (!project || !get().isInitiator()) throw new Error("Only the owner can change the cover.");
      if (!file) {
        if (project.coverPath) await api.removeProjectCover(project.id, project.coverPath);
        const current = get().project;
        if (current) set({ project: { ...current, coverPath: null } });
        return;
      }
      const image = await prepareCoverImage(file);
      const path = await api.setProjectCover(project.id, image, project.coverPath);
      const current = get().project;
      if (current) set({ project: { ...current, coverPath: path } });
    },

    deleteProject: async () => {
      const { project } = get();
      if (!project || !get().isInitiator()) throw new Error("Only the owner can delete a project.");
      engine.pause();
      await api.deleteProject(project.id);
    },

    unpublish: async () => {
      const { project } = get();
      if (!project || !get().isInitiator()) return;
      try {
        await api.unpublishProject(project.id);
        const current = get().project;
        if (current) set({ project: { ...current, status: "draft", publishedAt: null } });
      } catch (err) {
        console.error("Failed to unpublish:", err);
        set({ editError: `Couldn't unpublish the song${errorDetail(err)}` });
      }
    },
  };
});
