import { create } from "zustand";
import type { ProjectNote, Project, Track, Clip, ChannelFx, MasterMix, Group } from "../types/project";
import { AudioEngine, type RecordingResult } from "../lib/audioEngine";
import { useAuthStore } from "./useAuthStore";
import { useAccountStore } from "./useAccountStore";
import * as api from "../lib/projectApi";
import { listInputDevices, probeChannelCount, resolveInputDeviceId, chooseDevice, defaultDeviceFor, readSavedDevice, saveDevice, type InputDevice, DEFAULT_DEVICE_ID } from "../lib/inputDevices";
import { listOutputDevices, type OutputDevice } from "../lib/outputDevices";
import { nextZ, splitClip, duplicateClip, moveClip, audibleSegments } from "../lib/clips";
import { encodeTake } from "../lib/wav";
import { detectLoopBpm } from "../lib/tempoDetect";
import { mergeContiguous, joinRange } from "../lib/joinClips";
import { renderClipsToBuffer } from "../lib/joinRender";
import { timeStretch } from "../lib/timeStretch";
import { sliceFit } from "../lib/sliceFit";
import { detectChords, type ChordSegment } from "../lib/chords";
import { detectOnsets } from "../lib/onsets";
import { quantiseClip, planMoves } from "../lib/quantise";
import { stepSec, beatSec, type SnapResolution } from "../lib/grid";
import { readBwfStartSec } from "../lib/bwf";
import { planMoveSlice, canMoveBetween } from "../lib/moveClip";
import { clipEnd as clipEndSec } from "../lib/clips";
import { effectiveChannelMix } from "../lib/mix";
import { subscribeToProject, type RealtimeStatus, type PresentUser } from "../lib/realtime";
import { TRACK_COLORS } from "../lib/trackColors";
import { findOrphanFiles, takeIdFromFileName } from "../lib/orphans";
import { upsertClip, removeClip } from "../lib/remoteMerge";
import { orderTracks, moveId } from "../lib/trackOrder";
import { prepareCoverImage } from "../lib/coverImage";
import { clampFx, fxFromRow, presetPatch, resetPatch } from "../lib/channelFx";
import { groupFromRow } from "../lib/groups";
import { clampMasterVolume, DEFAULT_MASTER, masterFromRow, masterFxOnly } from "../lib/master";
import { rolesOf, roleBadge } from "../lib/roles";
import { can } from "../lib/rules";

/** The useful part of a Supabase / network error, for showing to the person. */
function errorDetail(err: unknown): string {
  const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return message ? ` (${message})` : "";
}

// Supabase's default per-object storage limit. Checked client-side before
// uploading a dropped file, so a too-long file gets a clear explanation
// instead of a raw storage error after the upload already ran.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** Heads-up when a take had to be turned down to fit full scale (see fitToFullScale in lib/wav.ts). */
function loweredNotice(label: string, db: number): string {
  return `${label} was louder than full scale, so it was turned down by ${db < 0.1 ? "less than 0.1" : db.toFixed(1)} dB to keep it from clipping.`;
}

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
  /** The Owner, the Mixer or a Player (assigned to a channel). Not a Listener. */
  isContributor: () => boolean;
  /** The Owner, the Mixer, the channel's own player, or (while the channel has no player) any contributor. */
  canRenameTrack: (track: Track) => boolean;
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
  /** Owner only: the time signature, as beats per bar over a quarter note (3 = 3/4). */
  setTimeSignature: (beatsPerBar: number) => Promise<void>;
  metronomeEnabled: boolean;
  toggleMetronome: () => void;
  metronomeVolume: number;
  setMetronomeVolume: (volume: number) => void;
  testMetronomeClick: () => void;
  countInEnabled: boolean;
  setCountInEnabled: (enabled: boolean) => void;
  /** How many bars of clicks play before a recording starts (1 to 3). */
  /** Whether the hints that appear when pointing at a button are shown. Kept on this device. */
  tooltipsOn: boolean;
  setTooltipsOn: (on: boolean) => void;
  /** Ask for the tempo of every audio file dropped (not only of loops that are found), so any file can be fitted to the song. Kept on this device. */
  askFileTempo: boolean;
  setAskFileTempo: (on: boolean) => void;
  countInBars: number;
  setCountInBars: (bars: number) => void;
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
  /** Finds how many inputs the Settings device has, without starting the level meter or asking for the microphone. Done once, never while playing or recording. */
  probeSettingsInput: (force?: boolean) => Promise<void>;
  /** `remember` (default) keeps the choice for next time; the automatic pick at start-up passes false. */
  setInputDevice: (deviceId: string, remember?: boolean) => Promise<void>;
  setInputChannel: (channelIndex: number | null) => void;
  /** Listen to the chosen input so its level shows (the "record another app" check); off stops it again when nothing else needs it. */
  watchInputLevel: (on: boolean) => void;
  /** Which input of the Settings device one channel records from (kept on this device); channels without a pick use the Settings choice. */
  channelInputs: Record<string, ChannelInput>;
  setChannelInput: (trackId: string, input: ChannelInput | null) => Promise<void>;

  availableOutputs: OutputDevice[];
  outputDeviceId: string;
  metronomeOutputDeviceId: string | null;
  masterOutputRoutingSupported: boolean;
  metronomeOutputRoutingSupported: boolean;
  loadingOutputs: boolean;
  refreshOutputDevices: () => Promise<void>;
  setOutputDevice: (deviceId: string, remember?: boolean) => Promise<void>;
  /** Puts back the input and output the person chose last time (or the system default) without opening any device. Runs when a project opens and when a device is plugged in or out. */
  restoreSavedDevices: () => Promise<void>;
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

  /** `stereo`: the channel records two inputs as one stereo take (chosen when it is added). */
  addTrack: (instrument: string, stereo?: boolean) => Promise<void>;
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
  /** Group channels (busses). The Owner makes and arranges them; the Owner and the Mixer set their mix; everyone hears them. */
  createGroup: (name: string) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  assignTrackToGroup: (trackId: string, groupId: string | null) => Promise<void>;
  setGroupVolume: (groupId: string, volume: number) => void;
  toggleGroupMute: (groupId: string) => void;
  toggleGroupSolo: (groupId: string) => void;
  setGroupPan: (groupId: string, pan: number) => void;
  setGroupFx: (groupId: string, patch: Partial<ChannelFx>, opts?: { checkpoint?: boolean }) => void;
  undoGroupFx: (groupId: string) => void;
  resetGroupFx: (groupId: string) => void;
  groupFxUndoCount: Record<string, number>;
  groupFxCompare: Record<string, boolean>;
  setGroupFxCompare: (groupId: string, dry: boolean) => void;
  /** How much taller each channel (and the master, under the key "master") is than normal. Kept on this device. */
  laneScales: Record<string, number>;
  setLaneScale: (id: string, scale: number) => void;
  /** Folded groups show only their header row. Kept on this device. */
  collapsedGroups: Record<string, boolean>;
  toggleGroupCollapsed: (groupId: string) => void;
  /** Moves a channel next to another one in the saved (or, for a player, personal) order. */
  moveTrackNear: (trackId: string, targetId: string, after: boolean) => Promise<void>;
  /** The master channel (saved on the project). Owner and Mixer change it; everyone hears it. */
  setMasterVolume: (volume: number) => void;
  /** Master mute: silences the whole song for you only. Never saved, never heard by others, never in an export. */
  masterMuted: boolean;
  toggleMasterMute: () => void;
  /** The master's EQ, compressor, limiter and power switch. Owner and Mixer only. */
  setMasterFx: (patch: Partial<ChannelFx> & { limiterOn?: boolean }, opts?: { checkpoint?: boolean }) => void;
  undoMasterFx: () => void;
  resetMasterFx: () => void;
  masterFxUndoCount: number;
  /** Hear the song without the master's effects, only for you and only for now. */
  masterCompare: boolean;
  setMasterCompare: (dry: boolean) => void;
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
  /** More clips of the same channel selected together with `selectedClip` (Shift or ⌘/Ctrl-click). */
  extraSelected: string[];
  /** Adds the clip to the selection, or takes it out; a clip of another channel starts a new selection. */
  toggleClipSelected: (selection: { trackId: string; clipId: string }) => void;
  /** Selects these clips of one channel (the first becomes the main one); with `add`, together with what is selected there already. */
  selectClips: (trackId: string, clipIds: string[], add?: boolean) => void;
  /** Selects every clip of the selected clip's channel. */
  selectAllInChannel: () => void;
  /** Joins the selected clips (two or more of one channel) into one clip. */
  joinSelected: () => Promise<void>;
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

  // ---- Quantise ----
  /** Where the hits of the selected clip are, on the timeline, while the Quantise panel is open (drawn on the clip). */
  quantiseMarks: { clipId: string; times: number[] } | null;
  setQuantiseMarks: (marks: { clipId: string; times: number[] } | null) => void;
  /** Finds the hits in the selected clip (and shows them on it). Returns how many, and how many would move. */
  previewQuantise: (options: { sensitivity: number; gridBeats: number; strength: number }) => { hits: number; moves: number } | null;
  /** Cuts the selected clip at its hits and moves them toward the grid. Returns how many hits moved, null if there was nothing to move, or false if saving failed (it was undone). */
  quantiseSelected: (options: { sensitivity: number; gridBeats: number; strength: number }) => Promise<number | null | false>;

  // ---- Notes ----
  notes: ProjectNote[];
  /** Master switch for the notes tray, the floating cards and the flags on the timeline. Saved on this device. */
  notesVisible: boolean;
  setNotesVisible: (visible: boolean) => void;
  /** Whether the notes panel is open (as the popup or in the bottom tray, whichever they sit in). */
  notesTrayOpen: boolean;
  setNotesTrayOpen: (open: boolean) => void;
  /** Where the notes sit: a popup under the toolbar (the default), or docked at the bottom of the screen. Kept on this device. */
  notesDock: "popup" | "bottom";
  setNotesDock: (dock: "popup" | "bottom") => void;
  /** A note that just tagged me (shown as a message at the top until dismissed or opened). */
  noteAlert: { id: string; from: string } | null;
  dismissNoteAlert: () => void;
  openNoteAlert: () => void;
  /** Notes popped out as floating cards, with where they sit and whether they are minimised to the bottom row. */
  noteCards: Record<string, NoteCardState>;
  floatNote: (id: string) => void;
  /** Pop every open note out as a card (and bring minimised ones back). */
  floatAllNotes: () => void;
  /** Take every card off the screen. */
  unfloatAllNotes: () => void;
  noteCardsLayout: NoteCardsLayout;
  /** Switch between the grid and the stack; this also puts dragged-away cards back in line. */
  setNoteCardsLayout: (layout: NoteCardsLayout) => void;
  /** The card shown on top of the stack. */
  noteCardFront: string | null;
  bringNoteFront: (id: string) => void;
  moveNoteCard: (id: string, x: number, y: number) => void;
  resizeNoteCard: (id: string, w: number, h: number) => void;
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
  /** The author of a note or the Owner may edit it, mark it done and reopen it. */
  canEditNote: (note: ProjectNote) => boolean;
  addNote: (input: { body: string; atBeat: number | null; trackId: string | null; mentions: string[]; sharedWithListeners: boolean }) => Promise<void>;
  editNote: (id: string, patch: Partial<{ body: string; atBeat: number | null; trackId: string | null; mentions: string[]; sharedWithListeners: boolean }>) => Promise<void>;
  setNoteDone: (id: string, done: boolean) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  jumpToNote: (id: string) => void;

  realtimeStatus: RealtimeStatus | "off";
  /** Who has this song open right now. */
  presentUsers: PresentUser[];
  /** True when the signed-in person holds no role in this song (e.g. the system owner observing it from /admin). */
  hasNoRole: () => boolean;
  /** Stop listening for changes and playback (call when leaving the song). */
  leaveProject: () => void;

  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;

  /** Imports an audio file dropped on a channel as a new clip, placed at `atSec`. */
  importAudioFile: (trackId: string, file: File, atSec: number, opts?: { skipLoopCheck?: boolean }) => Promise<void>;
  /** Several files dropped at once (stems from a DAW): one new channel per file, named after the file. */
  importAudioFiles: (files: File[], atSec: number) => Promise<void>;
  /** Where a dragged clip would land: the channel under it, the place on the timeline and its length (shown as an outline there), or null. */
  moveLanding: { trackId: string; startSec: number; durationSec: number } | null;
  setMoveLanding: (landing: { trackId: string; startSec: number; durationSec: number } | null) => void;
  /** The clip whose move is being saved right now (its outline stays in the new channel until the clip appears there). */
  movingClipId: string | null;
  /** Whether this person may move clips off this channel (their own channels, or any player's channels for the Owner). */
  canMoveClipsFrom: (track: Track) => boolean;
  /** Whether a clip on `from` may go to `to`: the same player's channel. */
  canMoveClipTo: (from: Track, to: Track) => boolean;
  /** Moves a clip to another channel of the same player (the recording is cut into a new one there). */
  moveClipToTrack: (clipId: string, fromTrackId: string, toTrackId: string, startSec: number) => Promise<void>;
  /** A channel currently importing a dropped file (for a small "Importing…" hint). */
  /** Channels an import is working on right now (several at once when stems are dropped together). */
  importingTrackIds: string[];
  /** The channel whose selected clips are being joined right now (a busy indicator shows on it and on the Join button). */
  joiningTrackId: string | null;
  /** A dropped loop whose tempo differs from the project's: waiting for the person to choose what to do. */
  loopTempoPrompt: LoopTempoPrompt | null;
  /** Fits the loop to the project's tempo ("match"), leaves it ("keep"), or (Owner, before any recording) sets the project to the loop's tempo ("project"). */
  confirmLoopTempo: (choice: { mode: "match" | "slice" | "keep" | "project"; bpm: number }) => Promise<void>;
  cancelLoopTempo: () => void;

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
  /** The signed-in person leaves this project for good (the Owner names who takes over). Returns the channels with recordings passed to the Owner. */
  quitProject: (newOwnerId?: string | null) => Promise<number>;
}

const LATENCY_STORAGE_KEY = "pyl.latencyMs";
const COUNT_IN_STORAGE_KEY = "pyl.countIn";
const COUNT_IN_BARS_KEY = "pyl.countInBars";
const TOOLTIPS_KEY = "pyl.tooltips";
const ASK_FILE_TEMPO_KEY = "pyl.askFileTempo";

// importAudioFile waits here while the tempo window is open, so files dropped together ask one after the other.
let loopPromptResolve: (() => void) | null = null;
const releaseLoopPrompt = () => {
  const done = loopPromptResolve;
  loopPromptResolve = null;
  done?.();
};
/** A count-in is one bar of clicks: 4 for 4/4 (this is only the fallback). */
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
const NOTES_DOCK_KEY = "pyl.notesDock";
/** Where a floating note card sits, and the size the owner dragged it to (unset = default size). */
export type NoteCardState = { x: number; y: number; min: boolean; w?: number; h?: number; free?: boolean };

/** How cards that have not been dragged away sit on the right of the screen. */
export type NoteCardsLayout = "grid" | "stack";

/** A dropped loop waiting for a tempo decision. */
export interface LoopTempoPrompt {
  trackId: string;
  fileName: string;
  atSec: number;
  buffer: AudioBuffer;
  /** The tempo found in the file name or the audio. */
  bpm: number;
  /** "ask": nothing was found, the person is asked for the tempo (Settings > Ask for the tempo of every file). */
  source: "filename" | "audio" | "ask";
  projectBpm: number;
}

/** The audio input (device, and which of its channels) a channel records from. */
export type ChannelInput = { deviceId: string; channelIndex: number | null };

const channelInputsKey = (projectId: string) => `pyl.channelInputs.${projectId}`;

function readChannelInputs(projectId: string): Record<string, ChannelInput> {
  try {
    const parsed = JSON.parse(localStorage.getItem(channelInputsKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeChannelInputs(projectId: string, inputs: Record<string, ChannelInput>) {
  try {
    localStorage.setItem(channelInputsKey(projectId), JSON.stringify(inputs));
  } catch {
    // the picks just won't be remembered
  }
}

const noteLayoutKey = "pyl.noteCardsLayout";

function readNoteLayout(): NoteCardsLayout {
  try {
    return localStorage.getItem(noteLayoutKey) === "stack" ? "stack" : "grid";
  } catch {
    return "grid";
  }
}

const noteCardsKey = (projectId: string) => `pyl.noteCards.${projectId}`;

/** Which channels of a project have their chords switched on. Saved on this device, so they come back next visit. */
const chordsKey = (projectId: string) => `pyl.chords.${projectId}`;
function readChordsWanted(projectId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(chordsKey(projectId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
function writeChordsWanted(projectId: string, trackId: string, wanted: boolean) {
  try {
    const rest = readChordsWanted(projectId).filter((id) => id !== trackId);
    const next = wanted ? [...rest, trackId] : rest;
    if (next.length) localStorage.setItem(chordsKey(projectId), JSON.stringify(next));
    else localStorage.removeItem(chordsKey(projectId));
  } catch {
    // storage unavailable — the choice just won't be remembered
  }
}

function readNotesVisible(): boolean {
  try {
    return localStorage.getItem(NOTES_VISIBLE_KEY) === "on"; // off by default
  } catch {
    return false;
  }
}

function readNotesDock(): "popup" | "bottom" {
  try {
    return localStorage.getItem(NOTES_DOCK_KEY) === "bottom" ? "bottom" : "popup";
  } catch {
    return "popup";
  }
}

function readNoteCards(projectId: string): Record<string, NoteCardState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(noteCardsKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeNoteCards(projectId: string, cards: Record<string, NoteCardState>) {
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
    Math.abs(a.durationSec - b.durationSec) < EPS &&
    Math.abs(a.fadeInSec - b.fadeInSec) < EPS &&
    Math.abs(a.fadeOutSec - b.fadeOutSec) < EPS
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
/** The master's undo steps for this visit, and a save waiting for the fader or knob to settle. */
const masterUndoStack: Pick<MasterMix, "fx" | "limiterOn">[] = [];
let masterLastCheckpoint = 0;
let pendingMaster: { timer: ReturnType<typeof setTimeout>; volume: boolean; fx: boolean } | null = null;
/** Group saves waiting for the fader or knob to settle, and the undo steps of each group's effects (this visit only). */
const pendingGroupSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; volume: boolean; muted: boolean; pan: boolean; fx: boolean }>();
const groupUndoStacks = new Map<string, ChannelFx[]>();
const groupLastCheckpoint = new Map<string, number>();
const laneScalesKey = (projectId: string) => `pyl.laneScales.${projectId}`;
function readLaneScales(projectId: string): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(laneScalesKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
const collapsedKey = (projectId: string) => `pyl.collapsedGroups.${projectId}`;
function readCollapsed(projectId: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(collapsedKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
/** The input device whose number of inputs was last looked up, and a look-up that is running. */
let probedInputFor: string | null = null;
let devicesWatched = false;
let inputProbeRunning = false;
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

function readStoredTooltips(): boolean {
  try {
    return localStorage.getItem(TOOLTIPS_KEY) !== "off"; // on by default
  } catch {
    return true;
  }
}

function readStoredCountInBars(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_IN_BARS_KEY));
    return n === 2 || n === 3 ? n : 1;
  } catch {
    return 1;
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

/**
 * The roles the signed-in person holds in this song. A person the Owner added as a player counts as a Player
 * (they can add their own channel); with `needsChannel` only someone who really has a channel does (the database
 * lets only those write notes).
 */
function myRoles(project: Project | null, needsChannel = false) {
  const uid = currentUserId();
  if (!project) return [];
  const withChannel = project.tracks.map((t) => t.assignedUserId);
  const added = project.listeners.filter((l) => l.canPlay).map((l) => l.userId);
  return rolesOf(
    {
      initiatorId: project.initiatorId,
      mixerId: project.mixerId,
      listenerIds: project.listeners.filter((l) => needsChannel || !l.canPlay).map((l) => l.userId),
      assignedUserIds: needsChannel ? withChannel : [...withChannel, ...added],
    },
    uid
  );
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
    engine.setMasterMix(project.master, get().masterMuted);
    // The groups first, so a channel can be wired into its group; then the channels.
    for (const g of project.groups) {
      engine.updateGroupMix(g.id, g.volume, g.muted, !!get().localSolo[g.id]);
      engine.setGroupPan(g.id, g.pan);
    }
    for (const track of project.tracks) {
      engine.setTrackGroup(track.id, track.groupId && project.groups.some((g) => g.id === track.groupId) ? track.groupId : null);
    }
    for (const track of project.tracks) {
      const m = get().effectiveMix(track);
      engine.updateTrackMix(track.id, m.volume, m.muted, m.solo);
      engine.setTrackPan(track.id, track.pan);
    }
  };

  /** Adds a decoded recording to a channel as a new clip: stored as a take (24-bit PCM WAV), loaded, placed, undoable. */
  const markImporting = (id: string, on: boolean) =>
    set((s) => ({ importingTrackIds: on ? [...s.importingTrackIds.filter((x) => x !== id), id] : s.importingTrackIds.filter((x) => x !== id) }));

  const placeImportedBuffer = async (trackId: string, fileName: string, buffer: AudioBuffer, atSec: number) => {
    const { project } = get();
    const uid = currentUserId();
    if (!project || !uid) return;
    // Re-encoded as 24-bit PCM WAV so every take in the song is the same lossless format, whatever the dropped file
    // originally was — but long files are still big (a minute of mono 48kHz is ~8.6 MB, stereo twice that), easily
    // past Supabase's per-file storage limit. Better to say so plainly than let the upload fail with a raw storage error.
    // A file that goes past full scale (a float bounce from a DAW) is turned down just enough to fit, not clipped.
    const { blob, loweredDb } = encodeTake(buffer);
    if (blob.size > MAX_IMPORT_BYTES) {
      const maxMinutes = (MAX_IMPORT_BYTES / (blob.size / buffer.duration) / 60).toFixed(1);
      set({
        editError: `"${fileName}" is too long at full quality (about ${Math.round(blob.size / 1024 / 1024)} MB) — this channel can take roughly ${maxMinutes} minutes at a time. Try a shorter clip.`,
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
      fadeInSec: 0,
      fadeOutSec: 0,
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
      ...(loweredDb > 0 ? { recordingNotice: loweredNotice(`"${fileName}"`, loweredDb) } : {}),
    });
    applyTrackClips(trackId, next);
    updateHistoryCounts();
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
  // The input a channel records from: the one picked for it, when that device is still connected,
  // otherwise the Settings input.
  const inputForTrack = (trackId: string | null): ChannelInput => {
    const own = trackId ? get().channelInputs[trackId] : undefined;
    if (own && own.deviceId === get().inputDeviceId) return own;
    return { deviceId: get().inputDeviceId, channelIndex: get().inputChannelIndex };
  };
  const startInputMeter = async () => {
    const input = inputForTrack(get().recordingTrackId ?? get().armedTrackId);
    const resolved = await resolveInputDeviceId(input.deviceId);
    await engine.startMonitoring(resolved, input.channelIndex);
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
    const extra = get().extraSelected;
    set({
      project: { ...project, tracks },
      durationSec: engine.getProjectDurationSec(),
      ...(stillSelected ? {} : { selectedClip: null }),
      // The other selected clips go with the primary one, or stay only while they still exist.
      ...(!stillSelected ? { extraSelected: [] } : selectedClip && selectedClip.trackId === trackId && extra.length ? { extraSelected: extra.filter((id) => clips.some((c) => c.id === id)) } : {}),
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

  /** Saves a new channel order: the Owner's is the song's default (saved for everyone), anyone else's stays on their device. */
  const saveChannelOrder = async (next: string[]) => {
    const { project } = get();
    if (!project) return;
    if (!get().isInitiator()) {
      writePersonalOrder(project.id, next);
      set({ personalOrder: next });
      return;
    }
    const before = project.tracks;
    set({ project: { ...project, tracks: before.map((t) => ({ ...t, position: next.indexOf(t.id) })) } });
    try {
      await api.setTrackOrder(next);
    } catch (err) {
      console.error("Failed to save the channel order:", err);
      const current = get().project;
      if (current) set({ project: { ...current, tracks: before }, editError: `Couldn't save the channel order${errorDetail(err)}` });
    }
  };

  // A group's mix: apply instantly, save once the fader or knob settles. Owner and Mixer only (the database checks too).
  const scheduleGroupSave = (groupId: string, what: { volume?: boolean; muted?: boolean; pan?: boolean; fx?: boolean }) => {
    const existing = pendingGroupSaves.get(groupId);
    if (existing) clearTimeout(existing.timer);
    const merged = {
      volume: !!(what.volume || existing?.volume),
      muted: !!(what.muted || existing?.muted),
      pan: !!(what.pan || existing?.pan),
      fx: !!(what.fx || existing?.fx),
    };
    const timer = setTimeout(async () => {
      pendingGroupSaves.delete(groupId);
      const project = get().project;
      const g = project?.groups.find((x) => x.id === groupId);
      if (!project || !g) return;
      try {
        await api.saveGroupMix(groupId, {
          ...(merged.volume ? { volume: g.volume } : {}),
          ...(merged.muted ? { muted: g.muted } : {}),
          ...(merged.pan ? { pan: g.pan } : {}),
          ...(merged.fx ? { fx: g.fx } : {}),
        });
        const latest = get().project;
        if (latest && latest.previewPath) set({ project: { ...latest, previewStale: true } });
      } catch (err) {
        console.error("Failed to save the group:", err);
        set({ editError: `Couldn't save that group change${errorDetail(err)}` });
      }
    }, 250);
    pendingGroupSaves.set(groupId, { timer, ...merged });
  };

  const applyGroupNow = (groupId: string, patch: Partial<Group>) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, groups: project.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) } });
    const g = get().project?.groups.find((x) => x.id === groupId);
    if (!g) return;
    engine.updateGroupMix(g.id, g.volume, g.muted, !!get().localSolo[g.id]);
    if (patch.pan !== undefined) engine.setGroupPan(g.id, g.pan);
    if (patch.fx) engine.updateGroupFx(g.id, g.fx);
  };

  // The master: apply instantly, save once the fader or knob settles. Owner and Mixer only (the database checks too).
  const scheduleMasterSave = (what: { volume?: boolean; fx?: boolean }) => {
    if (pendingMaster) clearTimeout(pendingMaster.timer);
    const merged = { volume: !!(what.volume || pendingMaster?.volume), fx: !!(what.fx || pendingMaster?.fx) };
    const timer = setTimeout(async () => {
      pendingMaster = null;
      const project = get().project;
      if (!project) return;
      const m = project.master;
      try {
        await api.saveMasterMix(project.id, {
          ...(merged.volume ? { volume: m.volume } : {}),
          ...(merged.fx ? { fxAndLimiter: { fx: m.fx, limiterOn: m.limiterOn } } : {}),
        });
        const latest = get().project;
        if (latest && latest.previewPath) set({ project: { ...latest, previewStale: true } });
      } catch (err) {
        console.error("Failed to save the master:", err);
        set({ editError: `Couldn't save that master change${errorDetail(err)}` });
      }
    }, 250);
    pendingMaster = { timer, ...merged };
  };

  const applyMasterNow = (patch: Partial<MasterMix>) => {
    const project = get().project;
    if (!project) return;
    const master: MasterMix = { ...project.master, ...patch };
    set({ project: { ...project, master } });
    engine.setMasterMix(master, get().masterMuted);
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
        groupId: "group_id" in row ? ((row.group_id as string | null) ?? null) : found.groupId,
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

  const handleGroupChange = (type: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>) => {
    const project = get().project;
    if (!project) return;
    const id = row.id as string;
    if (type === "DELETE") {
      engine.removeGroup(id);
      set({ project: { ...project, groups: project.groups.filter((g) => g.id !== id), tracks: project.tracks.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)) } });
      return;
    }
    const existing = project.groups.find((g) => g.id === id);
    const fresh = groupFromRow(row, existing);
    // While one of my own changes to this group is still being saved, its echo must not fight the control.
    const saving = pendingGroupSaves.has(id) && existing;
    const next: Group = saving ? { ...fresh, volume: existing.volume, muted: existing.muted, pan: existing.pan, fx: existing.fx } : fresh;
    set({ project: { ...project, groups: existing ? project.groups.map((g) => (g.id === id ? next : g)) : [...project.groups, next] } });
    if (!saving) engine.updateGroupFx(id, next.fx);
    syncMixToEngine();
  };

  const handleProjectChange = (row: Record<string, unknown>) => {
    const project = get().project;
    if (!project) return;
    const bpm = row.bpm as number;
    if (bpm !== project.bpm) engine.setBpm(bpm);
    const beatsPerBar = (row.beats_per_bar as number | undefined) ?? project.beatsPerBar;
    if (beatsPerBar !== project.beatsPerBar) engine.setBeatsPerBar(beatsPerBar);
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
    // While one of my own master changes is still being saved, its echo must not fight the control.
    const master = pendingMaster ? project.master : masterFromRow(row, project.master);
    if (!pendingMaster) engine.setMasterMix(master, get().masterMuted);
    set({
      project: {
        ...project,
        master,
        previewStale: "preview_stale" in row ? !!row.preview_stale : project.previewStale,
        mixerId,
        mixerName: mixerId && mixerId === project.mixerId ? project.mixerName : null,
        title: row.title as string,
        bpm,
        beatsPerBar,
        status: row.status as Project["status"],
        publishedAt: row.published_at ? new Date(row.published_at as string).getTime() : null,
      },
    });
  };

  // Catch up after a dropped connection or a phone waking up: reload the song's
  // rows quietly, reusing recordings we already have.
  /** The selected clip (if you may edit it and its recording is loaded) with the hits found in it. */
  const selectedClipAndOnsets = (sensitivity: number) => {
    const { project, selectedClip } = get();
    const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
    const clip = track?.clips.find((c) => c.id === selectedClip?.clipId);
    if (!project || !track || !clip || !get().canEditClips(track)) return null;
    const buffer = engine.getTakeBuffer(clip.takeId);
    if (!buffer) return null;
    const onsets = detectOnsets(buffer.getChannelData(0), buffer.sampleRate, clip.sourceStartSec, clip.durationSec, { sensitivity });
    return { clip, track, onsets, bpm: project.bpm };
  };

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
    await cleanUpLeftoverFilesAsOwner(project);
  };

  // The Owner also clears files that have NO take at all (a failed save, a deleted channel) in channels they cannot
  // edit: another player's channel, or one that no longer exists. Only files without a take row are removed, so a
  // recording a player could still bring back with Undo is never touched. Files younger than 10 minutes are skipped.
  const cleanUpLeftoverFilesAsOwner = async (project: Project) => {
    if (!get().isInitiator()) return;
    try {
      const takePaths = await api.listTakePaths(project.id);
      const folders = await api.listChannelFolders(project.id);
      for (const folder of folders) {
        const track = project.tracks.find((t) => t.id === folder);
        if (track && get().canEditClips(track)) continue; // the pass above handles the Owner's own channels
        const files = await api.listTrackFiles(project.id, folder);
        const withTake = new Set(files.filter((f) => takePaths.has(`${project.id}/${folder}/${f.name}`)).map((f) => f.name));
        const leftovers = findOrphanFiles(files, withTake, Date.now());
        if (leftovers.length === 0) continue;
        await api.removeTakeFiles(project.id, folder, leftovers.map((f) => f.name));
        console.info(`Owner cleanup: removed ${leftovers.length} leftover file(s) from ${track ? `"${track.instrument}"` : "a removed channel"}.`);
      }
    } catch (err) {
      console.warn("Owner storage cleanup skipped:", err);
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
    // The system owner observing a song they are not in stays out of the "who's here" dots.
    const observing = useAccountStore.getState().isAdmin && myRoles(get().project).length === 0;
    const me = uid && !observing ? { userId: uid, name } : null;
    // Live updates are a bonus: if they can't start, the song still opens (just without them).
    try {
      unsubscribeRealtime = subscribeToProject(projectId, {
        onPresence: (users) => set({ presentUsers: users }),
        onProject: handleProjectChange,
        onGroup: handleGroupChange,
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
    } catch (err) {
      console.error("Couldn't start live updates:", err);
      unsubscribeRealtime = null;
      set({ realtimeStatus: "offline" });
    }
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
    // Who may do what is decided in one table (lib/rules.ts); these only ask it.
    isContributor: () => can("add-channel", { roles: myRoles(get().project) }),
    canRenameTrack: (track) => {
      const uid = currentUserId();
      return can("rename-channel", { roles: myRoles(get().project), ownChannel: !!uid && track.assignedUserId === uid, unassigned: track.assignedUserId === null });
    },
    canEditClips: (track) => {
      const uid = currentUserId();
      return !!uid && can("record-edit-clips", { roles: myRoles(get().project), ownChannel: track.assignedUserId === uid });
    },
    tempoLocked: () => !!get().project?.tracks.some((t) => t.clips.length > 0),

    canMix: () => {
      const { project } = get();
      return !!project && can("final-mix", { roles: myRoles(project) });
    },
    // The Owner and the Mixer always; the channel's own player unless the channel is locked.
    canUseFx: (track) => {
      const uid = currentUserId();
      const roles = myRoles(get().project);
      if (!can("channel-fx", { roles, ownChannel: !!uid && track.assignedUserId === uid })) return false;
      return can("fx-lock", { roles }) || !track.fxLocked; // a locked channel's player cannot change it
    },

    roleLabel: () => {
      const { project } = get();
      if (!project) return null;
      return roleBadge(
        rolesOf(
          {
            initiatorId: project.initiatorId,
            mixerId: project.mixerId,
            listenerIds: project.listeners.filter((l) => !l.canPlay).map((l) => l.userId),
            assignedUserIds: [...project.tracks.map((t) => t.assignedUserId), ...project.listeners.filter((l) => l.canPlay).map((l) => l.userId)],
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
      masterUndoStack.length = 0;
      groupUndoStacks.clear();
      groupLastCheckpoint.clear();
      for (const pending of pendingGroupSaves.values()) clearTimeout(pending.timer);
      pendingGroupSaves.clear();
      fxLastCheckpoint.clear();
      set({ projectLoading: true, projectError: null, project: null, selectedClip: null, extraSelected: [], editError: null, loop: null, loopEnabled: false, armedTrackId: null, notes: [], noteAlert: null, notesTrayOpen: false, noteCards: {}, openFlagId: null, noteChannelFilter: null, fxUndoCount: {}, fxCompare: {}, chords: {}, chordsShown: {} });
      void get().restoreSavedDevices();
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
        for (const g of project.groups) engine.updateGroupFx(g.id, g.fx);
        engine.setBpm(project.bpm);
        engine.setBeatsPerBar(project.beatsPerBar);
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
        set({ noteCards: readNoteCards(project.id), channelInputs: readChannelInputs(project.id), collapsedGroups: readCollapsed(project.id), laneScales: readLaneScales(project.id) });
        void refreshNotes(project.id);
        // Bring back the chords the person had switched on here last time.
        void (async () => {
          for (const trackId of readChordsWanted(project.id)) {
            const track = get().project?.tracks.find((t) => t.id === trackId);
            if (get().project?.id !== project.id) return;
            if (track && track.clips.length > 0 && !get().chordsShown[trackId]) await get().toggleChords(trackId);
          }
        })();
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

    setTimeSignature: async (beatsPerBar) => {
      const { project } = get();
      if (!project || !get().isInitiator()) return;
      const value = Math.min(7, Math.max(2, Math.round(beatsPerBar)));
      if (value === project.beatsPerBar) return;
      const previous = project.beatsPerBar;
      // Bars are drawn and counted differently now, so detected chords (which lean on the bar line) are worked out again.
      set({ project: { ...project, beatsPerBar: value }, chords: {}, chordsShown: {} });
      engine.setBeatsPerBar(value);
      try {
        await api.setBeatsPerBar(project.id, value);
      } catch (err) {
        console.error("Failed to change the time signature:", err);
        const current = get().project;
        if (current) set({ project: { ...current, beatsPerBar: previous } });
        engine.setBeatsPerBar(previous);
        set({ editError: `Couldn't change the time signature${errorDetail(err)}` });
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
    askFileTempo: (() => {
      try {
        return localStorage.getItem(ASK_FILE_TEMPO_KEY) === "on";
      } catch {
        return false;
      }
    })(),
    setAskFileTempo: (on) => {
      set({ askFileTempo: on });
      try {
        if (on) localStorage.setItem(ASK_FILE_TEMPO_KEY, "on");
        else localStorage.removeItem(ASK_FILE_TEMPO_KEY);
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    tooltipsOn: readStoredTooltips(),
    setTooltipsOn: (on) => {
      set({ tooltipsOn: on });
      try {
        if (on) localStorage.removeItem(TOOLTIPS_KEY);
        else localStorage.setItem(TOOLTIPS_KEY, "off");
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
    countInBars: readStoredCountInBars(),
    setCountInBars: (bars) => {
      const clamped = bars === 2 || bars === 3 ? bars : 1;
      set({ countInBars: clamped });
      try {
        if (clamped === 1) localStorage.removeItem(COUNT_IN_BARS_KEY);
        else localStorage.setItem(COUNT_IN_BARS_KEY, String(clamped));
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
        const target = chooseDevice(inputs, readSavedDevice("input"));
        if (target !== current) {
          await get().setInputDevice(target, false);
        } else {
          const count = await probeChannelCount(current);
          set({ inputChannelCount: count });
          startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
        }
      } finally {
        set({ loadingInputs: false });
      }
    },

    probeSettingsInput: async (force) => {
      // Opening an audio device makes the computer re-configure its audio, which clicks whatever is playing:
      // so never while the song plays or a take is recorded, and only once per device.
      if (inputProbeRunning || get().isPlaying || get().recordingTrackId) return;
      if (!force && probedInputFor === get().inputDeviceId) return;
      inputProbeRunning = true;
      try {
        const inputs = await listInputDevices();
        set({ availableInputs: inputs });
        const id = get().inputDeviceId;
        const count = await probeChannelCount(id);
        probedInputFor = id;
        if (get().inputDeviceId === id) set({ inputChannelCount: count });
      } catch (err) {
        console.warn("Couldn't look up the inputs:", err);
      } finally {
        inputProbeRunning = false;
      }
    },

    setInputDevice: async (deviceId, remember = true) => {
      probedInputFor = null;
      if (remember) saveDevice("input", { id: deviceId, label: get().availableInputs.find((d) => d.deviceId === deviceId)?.label ?? "" });
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

    watchInputLevel: (on) => {
      if (on) {
        if (get().recordingTrackId) return;
        startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
      } else stopInputMeterIfIdle();
    },

    setInputChannel: (channelIndex) => {
      set({ inputChannelIndex: channelIndex });
      startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
    },

    channelInputs: {},
    setChannelInput: async (trackId, input) => {
      const project = get().project;
      if (!project) return;
      const next = { ...get().channelInputs };
      if (input) next[trackId] = input;
      else delete next[trackId];
      set({ channelInputs: next });
      writeChannelInputs(project.id, next);
      if (get().armedTrackId === trackId) {
        startInputMeter().catch((err) => console.error("Could not start input monitoring:", err));
      }
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
        await get().setOutputDevice(chooseDevice(outputs, readSavedDevice("output")), false);
      } finally {
        set({ loadingOutputs: false });
      }
    },

    setOutputDevice: async (deviceId, remember = true) => {
      set({ outputDeviceId: deviceId });
      if (remember) saveDevice("output", { id: deviceId, label: get().availableOutputs.find((d) => d.deviceId === deviceId)?.label ?? "" });
      // The click follows the main output automatically when it's set to
      // "same as main" (it's wired straight to the same destination).
      // "Default" goes out as the real device it stands for: the browser's own "default" can stay on a device that no longer is the default.
      await engine.setOutputDevice(deviceId === DEFAULT_DEVICE_ID ? (defaultDeviceFor(get().availableOutputs)?.deviceId ?? deviceId) : deviceId);
    },

    restoreSavedDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      if (!devicesWatched) {
        devicesWatched = true;
        navigator.mediaDevices.addEventListener?.("devicechange", () => void get().restoreSavedDevices());
      }
      try {
        // Without the microphone permission the browser hides names and ids: nothing to match yet, and asking now would be rude.
        const all = await navigator.mediaDevices.enumerateDevices();
        const named = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind && d.label);
        if (named("audiooutput").length > 0) await get().refreshOutputDevices();
        const inputs = named("audioinput").map((d) => ({ deviceId: d.deviceId || DEFAULT_DEVICE_ID, label: d.label }));
        // Not while recording or monitoring: changing the input then would cut it off.
        if (inputs.length > 0 && !get().recordingTrackId && !get().armedTrackId) {
          set({ availableInputs: inputs });
          const target = chooseDevice(inputs, readSavedDevice("input"));
          if (target !== get().inputDeviceId) set({ inputDeviceId: target, inputChannelIndex: null, inputChannelCount: 1 });
        }
      } catch (err) {
        console.warn("Couldn't restore the audio devices:", err);
      }
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

    addTrack: async (instrument, stereo = false) => {
      const { project } = get();
      // Anyone already in the song may add a new channel; only the Owner invites a
      // player to it (see createInvite).
      if (!project || !get().isContributor()) return;
      const color = TRACK_COLORS[project.tracks.length % TRACK_COLORS.length];
      const position = project.tracks.reduce((max, t) => Math.max(max, t.position), -1) + 1;
      // Everyone except the Owner plays the channel they add (the Owner often sets channels up for others).
      const uid = currentUserId();
      const mine = !get().isInitiator() && uid ? uid : null;
      const myName = useAuthStore.getState().profile?.displayName ?? null;
      try {
        const track = await api.addTrack(project.id, instrument, color, position, mine, myName, stereo);
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
      const target = project?.tracks.find((t) => t.id === trackId);
      if (!project || !trimmed || !target || !get().canRenameTrack(target)) return;
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
      const shown = orderTracks(project.tracks, get().isInitiator() ? null : get().personalOrder).map((t) => t.id);
      const from = shown.indexOf(trackId);
      if (from < 0 || from === toIndex) return;
      await saveChannelOrder(moveId(shown, from, toIndex));
    },
    moveTrackNear: async (trackId, targetId, after) => {
      const { project } = get();
      if (!project || trackId === targetId) return;
      const shown = orderTracks(project.tracks, get().isInitiator() ? null : get().personalOrder).map((t) => t.id);
      const rest = shown.filter((id) => id !== trackId);
      const at = rest.indexOf(targetId);
      if (at < 0 || !shown.includes(trackId)) return;
      rest.splice(at + (after ? 1 : 0), 0, trackId);
      if (rest.join() === shown.join()) return;
      await saveChannelOrder(rest);
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
          const bpb = project.beatsPerBar;
          const startBeat = Math.floor(positionSec / beat / bpb) * bpb;
          set({ loop: { startBeat, endBeat: startBeat + 4 * bpb }, loopEnabled: true });
        }
      } else {
        set({ loopEnabled: !loopEnabled });
      }
      syncLoop();
    },

    // ---- Group channels (busses) ----
    createGroup: async (name) => {
      const project = get().project;
      const trimmed = name.trim().slice(0, 40);
      if (!project || !trimmed || !get().isInitiator()) return;
      try {
        const color = TRACK_COLORS[project.groups.length % TRACK_COLORS.length];
        const id = await api.createTrackGroup(project.id, trimmed, color);
        const latest = get().project;
        if (latest && !latest.groups.some((g) => g.id === id)) {
          const position = latest.groups.reduce((m, g) => Math.max(m, g.position), -1) + 1;
          set({ project: { ...latest, groups: [...latest.groups, groupFromRow({ id, project_id: project.id, name: trimmed, color, position })] } });
          syncMixToEngine();
        }
      } catch (err) {
        console.error("Failed to create the group:", err);
        set({ editError: `Couldn't create that group${errorDetail(err)}` });
      }
    },
    renameGroup: async (groupId, name) => {
      const project = get().project;
      const trimmed = name.trim().slice(0, 40);
      const group = project?.groups.find((g) => g.id === groupId);
      if (!project || !group || !trimmed || trimmed === group.name || !get().isInitiator()) return;
      applyGroupNow(groupId, { name: trimmed });
      try {
        await api.renameTrackGroup(groupId, trimmed);
      } catch (err) {
        console.error("Failed to rename the group:", err);
        applyGroupNow(groupId, { name: group.name });
        set({ editError: `Couldn't rename that group${errorDetail(err)}` });
      }
    },
    deleteGroup: async (groupId) => {
      const project = get().project;
      if (!project || !get().isInitiator() || !project.groups.some((g) => g.id === groupId)) return;
      try {
        await api.deleteTrackGroup(groupId);
      } catch (err) {
        console.error("Failed to delete the group:", err);
        set({ editError: `Couldn't delete that group${errorDetail(err)}` });
        return;
      }
      // Its channels stay and play straight to the master.
      engine.removeGroup(groupId);
      const latest = get().project;
      if (latest) {
        set({ project: { ...latest, groups: latest.groups.filter((g) => g.id !== groupId), tracks: latest.tracks.map((t) => (t.groupId === groupId ? { ...t, groupId: null } : t)), previewStale: latest.previewPath ? true : latest.previewStale } });
        syncMixToEngine();
      }
    },
    assignTrackToGroup: async (trackId, groupId) => {
      const project = get().project;
      const track = project?.tracks.find((t) => t.id === trackId);
      if (!project || !track || !get().isInitiator() || track.groupId === groupId) return;
      const before = track.groupId;
      const apply = (value: string | null) => {
        const latest = get().project;
        if (latest) set({ project: { ...latest, tracks: latest.tracks.map((t) => (t.id === trackId ? { ...t, groupId: value } : t)) } });
        syncMixToEngine();
      };
      apply(groupId);
      try {
        await api.setTrackGroup(trackId, groupId);
        const latest = get().project;
        if (latest && latest.previewPath) set({ project: { ...latest, previewStale: true } });
      } catch (err) {
        console.error("Failed to move the channel into the group:", err);
        apply(before);
        set({ editError: `Couldn't move that channel${errorDetail(err)}` });
      }
    },
    setGroupVolume: (groupId, volume) => {
      if (!get().canMix()) return;
      applyGroupNow(groupId, { volume: Math.min(4, Math.max(0, volume)) });
      scheduleGroupSave(groupId, { volume: true });
    },
    toggleGroupMute: (groupId) => {
      const group = get().project?.groups.find((g) => g.id === groupId);
      if (!group || !get().canMix()) return;
      applyGroupNow(groupId, { muted: !group.muted });
      scheduleGroupSave(groupId, { muted: true });
    },
    // Solo is a listening aid for whoever presses it. It is never saved to the song.
    toggleGroupSolo: (groupId) => {
      set({ localSolo: { ...get().localSolo, [groupId]: !get().localSolo[groupId] } });
      syncMixToEngine();
    },
    setGroupPan: (groupId, pan) => {
      if (!get().canMix()) return;
      applyGroupNow(groupId, { pan: Math.min(1, Math.max(-1, pan)) });
      scheduleGroupSave(groupId, { pan: true });
    },
    groupFxUndoCount: {},
    setGroupFx: (groupId, patch, opts) => {
      const group = get().project?.groups.find((g) => g.id === groupId);
      if (!group || !get().canMix()) return;
      // A knob drag is many small changes: it counts as one undo step, started when the drag begins.
      const now = Date.now();
      if (opts?.checkpoint || now - (groupLastCheckpoint.get(groupId) ?? 0) > 1200) {
        const stack = groupUndoStacks.get(groupId) ?? [];
        stack.push(group.fx);
        if (stack.length > 40) stack.shift();
        groupUndoStacks.set(groupId, stack);
        set({ groupFxUndoCount: { ...get().groupFxUndoCount, [groupId]: stack.length } });
      }
      groupLastCheckpoint.set(groupId, now);
      applyGroupNow(groupId, { fx: { ...group.fx, ...clampFx(patch) } });
      scheduleGroupSave(groupId, { fx: true });
    },
    undoGroupFx: (groupId) => {
      const stack = groupUndoStacks.get(groupId);
      if (!stack?.length || !get().canMix()) return;
      const previous = stack.pop()!;
      groupLastCheckpoint.set(groupId, 0);
      set({ groupFxUndoCount: { ...get().groupFxUndoCount, [groupId]: stack.length } });
      applyGroupNow(groupId, { fx: previous });
      scheduleGroupSave(groupId, { fx: true });
    },
    resetGroupFx: (groupId) => {
      const group = get().project?.groups.find((g) => g.id === groupId);
      if (!group) return;
      get().setGroupFx(groupId, resetPatch(group.fx), { checkpoint: true });
    },
    groupFxCompare: {},
    setGroupFxCompare: (groupId, dry) => {
      engine.setGroupFxCompare(groupId, dry);
      set({ groupFxCompare: { ...get().groupFxCompare, [groupId]: dry } });
    },
    laneScales: {},
    setLaneScale: (id, scale) => {
      const project = get().project;
      if (!project) return;
      const next = { ...get().laneScales };
      if (Math.abs(scale - 1) < 0.02) delete next[id];
      else next[id] = Math.round(scale * 100) / 100;
      set({ laneScales: next });
      try {
        localStorage.setItem(laneScalesKey(project.id), JSON.stringify(next));
      } catch {
        // storage unavailable — the height just won't be remembered
      }
    },
    collapsedGroups: {},
    toggleGroupCollapsed: (groupId) => {
      const project = get().project;
      if (!project) return;
      const next = { ...get().collapsedGroups, [groupId]: !get().collapsedGroups[groupId] };
      set({ collapsedGroups: next });
      try {
        localStorage.setItem(collapsedKey(project.id), JSON.stringify(next));
      } catch {
        // storage unavailable — the fold just won't be remembered
      }
    },

    setMasterVolume: (volume) => {
      if (!get().canMix() || !get().project) return;
      applyMasterNow({ volume: clampMasterVolume(volume) });
      scheduleMasterSave({ volume: true });
    },
    masterMuted: false,
    toggleMasterMute: () => {
      const project = get().project;
      if (!project || !get().canMix()) return;
      const muted = !get().masterMuted;
      set({ masterMuted: muted });
      engine.setMasterMix(project.master, muted);
    },
    masterFxUndoCount: 0,
    setMasterFx: (patch, opts) => {
      const project = get().project;
      if (!project || !get().canMix()) return;
      const current = project.master;
      // A knob drag is many small changes: it counts as one undo step, started when the drag begins.
      const now = Date.now();
      if (opts?.checkpoint || now - masterLastCheckpoint > 1200) {
        masterUndoStack.push({ fx: current.fx, limiterOn: current.limiterOn });
        if (masterUndoStack.length > 40) masterUndoStack.shift();
        set({ masterFxUndoCount: masterUndoStack.length });
      }
      masterLastCheckpoint = now;
      const { limiterOn, ...fxPatch } = patch;
      applyMasterNow({ fx: masterFxOnly({ ...current.fx, ...clampFx(fxPatch) }), limiterOn: limiterOn ?? current.limiterOn });
      scheduleMasterSave({ fx: true });
    },
    undoMasterFx: () => {
      const project = get().project;
      if (!project || !get().canMix() || masterUndoStack.length === 0) return;
      const previous = masterUndoStack.pop()!;
      masterLastCheckpoint = 0;
      set({ masterFxUndoCount: masterUndoStack.length });
      applyMasterNow({ fx: previous.fx, limiterOn: previous.limiterOn });
      scheduleMasterSave({ fx: true });
    },
    resetMasterFx: () => {
      const project = get().project;
      if (!project) return;
      get().setMasterFx({ ...resetPatch(project.master.fx), limiterOn: DEFAULT_MASTER.limiterOn }, { checkpoint: true });
    },
    masterCompare: false,
    setMasterCompare: (dry) => {
      engine.setMasterCompare(dry);
      set({ masterCompare: dry });
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
    extraSelected: [],
    selectClip: (selection) => set({ selectedClip: selection, extraSelected: [] }),
    toggleClipSelected: (sel) => {
      const { selectedClip, extraSelected } = get();
      if (!selectedClip || selectedClip.trackId !== sel.trackId) {
        set({ selectedClip: sel, extraSelected: [] });
        return;
      }
      if (sel.clipId === selectedClip.clipId) {
        // Taking the main one out: the next one (if any) becomes the main one.
        const [next, ...rest] = extraSelected;
        set(next ? { selectedClip: { trackId: sel.trackId, clipId: next }, extraSelected: rest } : { selectedClip: null, extraSelected: [] });
        return;
      }
      set({ extraSelected: extraSelected.includes(sel.clipId) ? extraSelected.filter((id) => id !== sel.clipId) : [...extraSelected, sel.clipId] });
    },
    selectClips: (trackId, clipIds, add = false) => {
      const { selectedClip, extraSelected } = get();
      const kept = add && selectedClip?.trackId === trackId ? [selectedClip.clipId, ...extraSelected] : [];
      const all = [...new Set([...kept, ...clipIds])];
      if (all.length === 0) set({ selectedClip: null, extraSelected: [] });
      else set({ selectedClip: { trackId, clipId: all[0] }, extraSelected: all.slice(1) });
    },
    selectAllInChannel: () => {
      const { project, selectedClip } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      if (!track || !selectedClip || !get().canEditClips(track) || track.clips.length === 0) return;
      const rest = track.clips.filter((c) => c.id !== selectedClip.clipId).map((c) => c.id);
      set({ extraSelected: rest });
    },
    joinSelected: async () => {
      const { project, selectedClip, extraSelected } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      const uid = currentUserId();
      if (!project || !track || !selectedClip || !uid || !get().canEditClips(track) || get().recordingTrackId || get().joiningTrackId) return;
      const ids = new Set([selectedClip.clipId, ...extraSelected]);
      const chosen = track.clips.filter((c) => ids.has(c.id));
      if (chosen.length < 2) return;
      const rest = track.clips.filter((c) => !ids.has(c.id));
      // Consecutive pieces of one recording simply become one clip again: nothing to render or store.
      const merged = mergeContiguous(chosen);
      if (merged) {
        if (await get().commitClips(track.id, [...rest, merged])) set({ selectedClip: { trackId: track.id, clipId: merged.id }, extraSelected: [] });
        return;
      }
      // Otherwise what is heard of them (fades and overlaps included) becomes one new recording that replaces them.
      // It takes a moment (render, save, upload): the busy indicator stays up for at least a short while so it is seen.
      const startedAt = Date.now();
      set({ joiningTrackId: track.id, editError: null });
      try {
        const buffers = new Map<string, AudioBuffer>();
        for (const c of chosen) {
          const b = engine.getTakeBuffer(c.takeId);
          if (!b) throw new Error("one of the recordings is not loaded yet");
          buffers.set(c.takeId, b);
        }
        const range = joinRange(chosen);
        const rendered = await renderClipsToBuffer(chosen, buffers, range);
        const { blob, loweredDb } = encodeTake(rendered);
        if (blob.size > MAX_IMPORT_BYTES) {
          set({ editError: `Those clips are too long to join into one recording (about ${Math.round(blob.size / 1024 / 1024)} MB at full quality). Join fewer of them.` });
          return;
        }
        const take = await api.createTake({ projectId: project.id, trackId: track.id, blob, durationSec: rendered.duration, userId: uid });
        await engine.loadTake(take.id, blob);
        const current = get().project;
        if (!current) return;
        set({ project: { ...current, takes: { ...current.takes, [take.id]: take } }, takesVersion: get().takesVersion + 1 });
        const clip: Clip = { id: crypto.randomUUID(), takeId: take.id, startSec: range.startSec, sourceStartSec: 0, durationSec: rendered.duration, z: nextZ(track.clips), fadeInSec: 0, fadeOutSec: 0 };
        if (await get().commitClips(track.id, [...rest, clip])) {
          set({
            selectedClip: { trackId: track.id, clipId: clip.id },
            extraSelected: [],
            ...(loweredDb > 0 ? { recordingNotice: loweredNotice("The joined clip", loweredDb) } : {}),
          });
        }
      } catch (err) {
        console.error("Failed to join the clips:", err);
        set({ editError: `Couldn't join those clips${errorDetail(err)}` });
      } finally {
        const wait = 600 - (Date.now() - startedAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        set({ joiningTrackId: null });
      }
    },
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
      const { project, selectedClip, extraSelected } = get();
      const track = project?.tracks.find((t) => t.id === selectedClip?.trackId);
      if (!project || !track || !selectedClip) return;
      const ids = new Set([selectedClip.clipId, ...extraSelected]);
      await get().commitClips(track.id, track.clips.filter((c) => !ids.has(c.id)));
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
        const step = stepSec(project.bpm, snapResolution, project.beatsPerBar);
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
        const nowShown = !chordsShown[trackId];
        set({ chordsShown: { ...chordsShown, [trackId]: nowShown } });
        writeChordsWanted(project.id, trackId, nowShown);
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
            }, project.beatsPerBar)
          );
        }
        found.sort((a, b) => a.startBeat - b.startBeat);
        if (get().project?.id !== project.id) return;
        set({ chords: { ...get().chords, [trackId]: found }, chordsShown: { ...get().chordsShown, [trackId]: true } });
        writeChordsWanted(project.id, trackId, true);
      } catch (err) {
        console.error("Failed to detect the chords:", err);
        set({ editError: `Couldn't work out the chords${errorDetail(err)}` });
      } finally {
        set({ detectingChords: null });
      }
    },

    quantiseMarks: null,
    setQuantiseMarks: (marks) => set({ quantiseMarks: marks }),
    previewQuantise: ({ sensitivity, gridBeats, strength }) => {
      const found = selectedClipAndOnsets(sensitivity);
      if (!found) {
        set({ quantiseMarks: null });
        return null;
      }
      const { clip, onsets, bpm } = found;
      const moves = planMoves(clip, onsets, bpm, { gridBeats, strength });
      set({ quantiseMarks: { clipId: clip.id, times: moves.map((m) => m.from) } });
      return { hits: moves.length, moves: moves.filter((m) => Math.abs(m.to - m.from) > 0.0008).length };
    },
    quantiseSelected: async ({ sensitivity, gridBeats, strength }) => {
      const found = selectedClipAndOnsets(sensitivity);
      if (!found) return null;
      const { clip, track, onsets, bpm } = found;
      const result = quantiseClip(clip, onsets, bpm, { gridBeats, strength }, () => crypto.randomUUID());
      if (!result) return null;
      const ok = await get().commitClips(track.id, track.clips.flatMap((c) => (c.id === clip.id ? result.clips : [c])));
      set({ quantiseMarks: null });
      return ok ? result.moved : false;
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
    notesDock: readNotesDock(),
    setNotesDock: (dock) => {
      // Docking or popping out keeps the notes open, where they now are.
      set({ notesDock: dock, notesTrayOpen: true });
      try {
        if (dock === "bottom") localStorage.setItem(NOTES_DOCK_KEY, "bottom");
        else localStorage.removeItem(NOTES_DOCK_KEY);
      } catch {
        // storage unavailable — the setting just won't persist
      }
    },
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
      const next = { ...get().noteCards, [id]: { x: 0, y: 0, min: false } };
      set({ noteCards: next, noteCardFront: id });
      writeNoteCards(project.id, next);
    },
    floatAllNotes: () => {
      const project = get().project;
      if (!project) return;
      const next = { ...get().noteCards };
      for (const n of get().notes) {
        if (n.done) continue;
        next[n.id] = next[n.id] ? { ...next[n.id], min: false } : { x: 0, y: 0, min: false };
      }
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    unfloatAllNotes: () => {
      const project = get().project;
      if (!project) return;
      set({ noteCards: {}, noteCardFront: null });
      writeNoteCards(project.id, {});
    },
    noteCardsLayout: readNoteLayout(),
    setNoteCardsLayout: (layout) => {
      const project = get().project;
      try {
        localStorage.setItem(noteLayoutKey, layout);
      } catch {
        // the layout just goes back to the grid next time
      }
      const next: Record<string, NoteCardState> = {};
      for (const [id, c] of Object.entries(get().noteCards)) next[id] = { ...c, free: false };
      set({ noteCardsLayout: layout, noteCards: next });
      if (project) writeNoteCards(project.id, next);
    },
    noteCardFront: null,
    bringNoteFront: (id) => set({ noteCardFront: id }),
    moveNoteCard: (id, x, y) => {
      const project = get().project;
      const card = get().noteCards[id];
      if (!project || !card) return;
      const next = { ...get().noteCards, [id]: { ...card, x, y, free: true } };
      set({ noteCards: next });
      writeNoteCards(project.id, next);
    },
    resizeNoteCard: (id, w, h) => {
      const project = get().project;
      const card = get().noteCards[id];
      if (!project || !card) return;
      const next = { ...get().noteCards, [id]: { ...card, w, h } };
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
    canWriteNotes: () => can("write-notes", { roles: myRoles(get().project, true) }),
    canEditNote: (note) => {
      const uid = currentUserId();
      return can("note-edit-done", { roles: myRoles(get().project, true), author: !!uid && note.authorId === uid });
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
    hasNoRole: () => !!get().project && myRoles(get().project).length === 0,
    leaveProject: () => {
      engine.pause();
      engine.stopMonitoring();
      stopRealtime();
      set({ realtimeStatus: "off", presentUsers: [], armedTrackId: null, fxUndoCount: {}, fxCompare: {}, notes: [], noteAlert: null, notesTrayOpen: false, noteCards: {}, openFlagId: null });
    },

    pause: () => engine.pause(),
    seek: (sec) => engine.seek(sec),

    importingTrackIds: [],
    joiningTrackId: null,
    loopTempoPrompt: null,
    cancelLoopTempo: () => {
      set({ loopTempoPrompt: null });
      releaseLoopPrompt();
    },
    confirmLoopTempo: async ({ mode, bpm }) => {
      const prompt = get().loopTempoPrompt;
      const project = get().project;
      if (!prompt || !project) return;
      set({ loopTempoPrompt: null, editError: null });
      markImporting(prompt.trackId, true);
      try {
        let buffer = prompt.buffer;
        const loopBpm = Math.min(300, Math.max(40, bpm));
        if (mode === "project") {
          await get().setTempo(loopBpm);
        } else if (mode === "match" || mode === "slice") {
          // Let the "Importing…" hint show before the number crunching starts.
          await new Promise((r) => setTimeout(r, 30));
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
          const ratio = loopBpm / project.bpm;
          let stretched: Float32Array[] | null = null;
          if (mode === "slice") {
            // Cut at the hits and move each to its place at the new tempo: the hits keep their exact sound.
            const mono = new Float32Array(buffer.length);
            for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
            const hits = detectOnsets(mono, buffer.sampleRate, 0, buffer.duration, { sensitivity: 0.5 });
            if (hits.length >= 2) stretched = sliceFit(channels, buffer.sampleRate, ratio, hits);
            else set({ recordingNotice: `No separate hits were found in "${prompt.fileName}", so it was stretched instead.` });
          }
          stretched ??= timeStretch(channels, buffer.sampleRate, ratio);
          const out = new AudioBuffer({ length: stretched[0].length, sampleRate: buffer.sampleRate, numberOfChannels: stretched.length });
          stretched.forEach((data, c) => out.copyToChannel(new Float32Array(data), c));
          buffer = out;
        }
        await placeImportedBuffer(prompt.trackId, prompt.fileName, buffer, prompt.atSec);
      } catch (err) {
        console.error("Failed to fit the loop:", err);
        set({ editError: `Couldn't add "${prompt.fileName}"${errorDetail(err)}` });
      } finally {
        markImporting(prompt.trackId, false);
        releaseLoopPrompt();
      }
    },
    importAudioFile: async (trackId, file, atSec, opts) => {
      const { project } = get();
      const track = project?.tracks.find((t) => t.id === trackId);
      const uid = currentUserId();
      if (!project || !track || !uid) return;
      if (!get().canEditClips(track)) {
        set({ editError: `You can only add audio to a channel that is yours, so "${file.name}" was not added.` });
        return;
      }
      if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|ogg|flac|aiff?)$/i.test(file.name)) {
        set({ editError: `"${file.name}" doesn't look like an audio file.` });
        return;
      }

      set({ editError: null });
      markImporting(trackId, true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        // A stem exported from a DAW can carry the place it starts at (WAV time stamp): use it instead of the drop point.
        // Read before decoding, which takes the buffer away.
        const stamped = readBwfStartSec(arrayBuffer);
        if (stamped !== null && stamped > 0.01) {
          atSec = stamped;
          const bar = Math.floor(stamped / (beatSec(project.bpm) * project.beatsPerBar)) + 1;
          set({ recordingNotice: `"${file.name}" carries its own start time, so it was placed at bar ${bar}.` });
        }
        // A short-lived context just for decoding — the engine's own context
        // stays untouched until the take is ready to place.
        const decodeCtx = new AudioContext();
        let buffer: AudioBuffer;
        try {
          buffer = await decodeCtx.decodeAudioData(arrayBuffer);
        } finally {
          await decodeCtx.close();
        }
        // A loop at another tempo than the song: ask what to do with it (a recording that is not a loop is left alone).
        // With "ask for the tempo of every file" on, files that are not found to be loops are asked about too (and dropped stems are checked).
        const askAlways = get().askFileTempo;
        const found = opts?.skipLoopCheck && !askAlways ? null : detectLoopBpm(buffer.getChannelData(0), buffer.sampleRate, file.name);
        if ((found && Math.abs(found.bpm - project.bpm) / project.bpm > 0.01) || (!found && askAlways)) {
          set({ loopTempoPrompt: { trackId, fileName: file.name, atSec, buffer, bpm: found?.bpm ?? project.bpm, source: found?.source ?? "ask", projectBpm: project.bpm } });
          // Wait for the answer, so several files dropped together are asked one after the other.
          await new Promise<void>((resolve) => {
            loopPromptResolve = resolve;
          });
          return;
        }
        await placeImportedBuffer(trackId, file.name, buffer, atSec);
      } catch (err) {
        console.error("Failed to import audio file:", err);
        set({ editError: `Couldn't add "${file.name}"${errorDetail(err)}` });
      } finally {
        markImporting(trackId, false);
      }
    },

    moveLanding: null,
    movingClipId: null,
    setMoveLanding: (landing) => {
      const cur = get().moveLanding;
      if (cur === landing || (cur && landing && cur.trackId === landing.trackId && cur.startSec === landing.startSec && cur.durationSec === landing.durationSec)) return;
      set({ moveLanding: landing });
    },
    canMoveClipsFrom: (track) => {
      const { project } = get();
      const uid = currentUserId();
      if (!project || !uid || !track.assignedUserId || get().recordingTrackId) return false;
      if (!(track.assignedUserId === uid || get().isInitiator())) return false;
      return project.tracks.some((t) => canMoveBetween({ userId: uid, isOwner: get().isInitiator() }, track, t));
    },
    canMoveClipTo: (from, to) => canMoveBetween({ userId: currentUserId(), isOwner: get().isInitiator() }, from, to),
    moveClipToTrack: async (clipId, fromTrackId, toTrackId, startSec) => {
      const { project } = get();
      const uid = currentUserId();
      const from = project?.tracks.find((t) => t.id === fromTrackId);
      const to = project?.tracks.find((t) => t.id === toTrackId);
      const clip = from?.clips.find((c) => c.id === clipId);
      if (!project || !uid || !from || !to || !clip) return;
      if (!get().canMoveClipTo(from, to)) {
        set({ editError: "A clip can only move to another channel of the same player." });
        return;
      }
      if (get().recordingTrackId || get().joiningTrackId) return;
      markImporting(to.id, true);
      // The outline marking the drop stays in the new channel, and the old clip stays dimmed, until the clip is there.
      set({ editError: null, moveLanding: { trackId: to.id, startSec: Math.max(0, startSec), durationSec: clip.durationSec }, movingClipId: clip.id });
      try {
        const source = engine.getTakeBuffer(clip.takeId);
        const take = project.takes[clip.takeId];
        if (!source || !take) throw new Error("the recording is not loaded yet");
        // Copy the piece (with a handle each side) sample for sample, so nothing about the sound changes.
        const plan = planMoveSlice(clip, source.duration);
        const first = Math.floor(plan.sliceStartSec * source.sampleRate);
        const last = Math.min(source.length, Math.ceil(plan.sliceEndSec * source.sampleRate));
        const piece = new AudioBuffer({ length: Math.max(1, last - first), numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate });
        for (let ch = 0; ch < source.numberOfChannels; ch++) piece.copyToChannel(source.getChannelData(ch).subarray(first, last), ch);
        const { blob } = encodeTake(piece);
        if (blob.size > MAX_IMPORT_BYTES) throw new Error("that clip is too long to move (about " + Math.round(blob.size / 1024 / 1024) + " MB)");
        const newSourceStart = clip.sourceStartSec - first / source.sampleRate;
        const newClip: Clip = { ...clip, id: crypto.randomUUID(), startSec: Math.max(0, startSec), sourceStartSec: newSourceStart, z: nextZ(to.clips) };
        const newTake = await api.moveClipToChannel({ projectId: project.id, clipId: clip.id, toTrackId: to.id, blob, takeDurationSec: piece.duration, newClip, userId: uid });
        await engine.loadTake(newTake.id, blob);
        const current = get().project;
        if (!current) return;
        // The clip now plays the NEW recording (its start inside it was measured in the new one): a clip left pointing at the
        // old recording would sound shifted and be refused by the database the next time it is saved (a cut, a trim).
        const placed: Clip = { ...newClip, takeId: newTake.id };
        const tracks = current.tracks.map((t) => {
          if (t.id === from.id) return { ...t, clips: t.clips.filter((c) => c.id !== clip.id) };
          if (t.id === to.id) return { ...t, clips: [...t.clips.filter((c) => c.id !== placed.id), placed] };
          return t;
        });
        set({ project: { ...current, tracks, takes: { ...current.takes, [newTake.id]: newTake } }, takesVersion: get().takesVersion + 1, selectedClip: { trackId: to.id, clipId: placed.id }, extraSelected: [] });
        applyTrackClips(from.id, tracks.find((t) => t.id === from.id)?.clips ?? []);
        applyTrackClips(to.id, tracks.find((t) => t.id === to.id)?.clips ?? []);
        // Undo history is kept per channel, so an older step could bring the moved clip back on the old channel: start it afresh.
        // (To take a move back, drag the clip back.)
        undoStack.length = 0;
        redoStack = [];
        updateHistoryCounts();
      } catch (err) {
        console.error("Failed to move the clip:", err);
        set({ editError: `Couldn't move that clip${errorDetail(err)}` });
      } finally {
        markImporting(to.id, false);
        set({ moveLanding: null, movingClipId: null });
      }
    },

    importAudioFiles: async (files, atSec) => {
      if (!get().project || !get().isContributor()) return;
      // First the channels, one after the other (each needs the one before it for its place in the list), so they all
      // appear at once; then the files are read, converted and uploaded three at a time, which is what takes the time.
      const jobs: { trackId: string; file: File }[] = [];
      for (const file of files) {
        const before = new Set(get().project?.tracks.map((t) => t.id));
        const name = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 40) || "Stem";
        await get().addTrack(name);
        const added = get().project?.tracks.find((t) => !before.has(t.id));
        if (!added) break; // the channel could not be added; addTrack has said why
        // The Owner's new channel belongs to nobody, and nobody edits a channel that is not theirs: make it the Owner's own first.
        const uid = currentUserId();
        if (!added.assignedUserId && uid) {
          try {
            await get().assignTrackToUser(added.id, uid);
          } catch (err) {
            console.error("Could not assign the new channel:", err);
            set({ editError: `Couldn't set up a channel for "${file.name}"${errorDetail(err)}` });
            break;
          }
        }
        markImporting(added.id, true); // the channel shows its spinner while it waits its turn
        jobs.push({ trackId: added.id, file });
      }
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          // Stems are not loops, so no tempo question; each one starts where the others do.
          await get().importAudioFile(job.trackId, job.file, atSec, { skipLoopCheck: true });
          markImporting(job.trackId, false); // also when the import stopped before it began
        }
      };
      // One at a time when the tempo is asked for each file; otherwise three at a time.
      await Promise.all(Array.from({ length: Math.min(get().askFileTempo ? 1 : 3, jobs.length) }, worker));
    },

    startRecording: async (trackId) => {
      const { project } = get();
      if (!project) return;
      const track = project.tracks.find((t) => t.id === trackId);
      if (!track || !get().canEditClips(track)) return;

      set({ recordingTrackId: trackId, recordingPhase: "requesting-mic", recordingError: null });

      try {
        await engine.resume();
        const input = inputForTrack(trackId);
        const resolvedDeviceId = await resolveInputDeviceId(input.deviceId);
        await engine.startRecording(resolvedDeviceId, input.channelIndex, track.stereo);
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
        countInBeats: get().countInEnabled ? (get().project?.beatsPerBar ?? COUNT_IN_BEATS) * get().countInBars : 0,
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
          fadeInSec: 0,
          fadeOutSec: 0,
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

    quitProject: async (newOwnerId = null) => {
      const { project } = get();
      if (!project) throw new Error("No project is open.");
      engine.pause();
      return api.leaveProject(project.id, newOwnerId);
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
