import { supabase } from "./supabaseClient";
import type { ProjectNote, Project, Track, Take, Clip, ChannelFx } from "../types/project";
import { DEFAULT_CHANNEL_FX } from "../types/project";
import type { StoredFile } from "./orphans";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return supabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProject(row: any, tracks: Track[], takes: Record<string, Take>): Project {
  return {
    id: row.id,
    title: row.title,
    bpm: row.bpm,
    initiatorId: row.initiator_id,
    mixerId: row.mixer_id ?? null,
    mixerName: null,
    initiatorName: null,
    coverPath: row.cover_path ?? null,
    listeners: [],
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    publishedAt: row.published_at ? new Date(row.published_at).getTime() : null,
    tracks,
    takes,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTake(row: any): Take {
  return {
    id: row.id,
    trackId: row.track_id,
    storagePath: row.storage_path,
    blob: null,
    durationSec: row.duration_sec,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).getTime(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapClip(row: any): Clip {
  return {
    id: row.id,
    takeId: row.take_id,
    startSec: row.start_sec,
    sourceStartSec: row.source_start_sec,
    durationSec: row.duration_sec,
    z: row.z,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTrack(row: any, clips: Clip[], assignedPlayerName: string | null): Track {
  return {
    id: row.id,
    projectId: row.project_id,
    instrument: row.instrument,
    color: row.color,
    position: row.position ?? 0,
    assignedUserId: row.assigned_user_id,
    assignedPlayerName,
    clips,
    volume: row.volume,
    muted: row.muted,
    pan: row.pan ?? 0,
    fx: {
      eqLow: row.eq_low ?? DEFAULT_CHANNEL_FX.eqLow,
      eqMid: row.eq_mid ?? DEFAULT_CHANNEL_FX.eqMid,
      eqHigh: row.eq_high ?? DEFAULT_CHANNEL_FX.eqHigh,
      compAmount: row.comp_amount ?? DEFAULT_CHANNEL_FX.compAmount,
      delayTimeMs: row.delay_time_ms ?? DEFAULT_CHANNEL_FX.delayTimeMs,
      delayMix: row.delay_mix ?? DEFAULT_CHANNEL_FX.delayMix,
      reverbMix: row.reverb_mix ?? DEFAULT_CHANNEL_FX.reverbMix,
    },
  };
}

export async function getProject(id: string): Promise<Project> {
  const client = requireSupabase();

  const { data: projectRow, error: projectError } = await client.from("projects").select("*").eq("id", id).single();
  if (projectError) throw projectError;

  const { data: trackRows, error: tracksError } = await client
    .from("tracks")
    .select("*")
    .eq("project_id", id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (tracksError) throw tracksError;

  const trackIds = (trackRows ?? []).map((t) => t.id);
  const { data: listenerRows, error: listenersError } = await client.from("project_listeners").select("user_id").eq("project_id", id);
  if (listenersError) throw listenersError;
  const listenerIds = (listenerRows ?? []).map((r) => r.user_id as string);
  const assignedUserIds = [
    ...new Set([
      ...(trackRows ?? []).map((t) => t.assigned_user_id).filter((v): v is string => !!v),
      ...listenerIds,
      ...(projectRow.mixer_id ? [projectRow.mixer_id as string] : []),
      projectRow.initiator_id as string,
    ]),
  ];

  const clipsResult = trackIds.length
    ? await client.from("clips").select("*").in("track_id", trackIds).order("z", { ascending: true })
    : { data: [], error: null };
  if (clipsResult.error) throw clipsResult.error;
  const clipRows = clipsResult.data ?? [];

  const takeIds = [...new Set(clipRows.map((c) => c.take_id as string))];
  const [takesResult, profilesResult] = await Promise.all([
    takeIds.length ? client.from("takes").select("*").in("id", takeIds) : Promise.resolve({ data: [], error: null }),
    assignedUserIds.length
      ? client.from("profiles").select("id, display_name").in("id", assignedUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (takesResult.error) throw takesResult.error;
  if (profilesResult.error) throw profilesResult.error;

  const takes: Record<string, Take> = {};
  for (const row of takesResult.data ?? []) takes[row.id] = mapTake(row);
  const namesById = new Map((profilesResult.data ?? []).map((p) => [p.id, p.display_name as string | null]));

  const tracks = (trackRows ?? []).map((t) =>
    mapTrack(
      t,
      clipRows.filter((c) => c.track_id === t.id).map(mapClip),
      namesById.get(t.assigned_user_id ?? "") ?? null
    )
  );

  const project = mapProject(projectRow, tracks, takes);
  project.initiatorName = namesById.get(project.initiatorId) ?? null;
  project.mixerName = project.mixerId ? (namesById.get(project.mixerId) ?? null) : null;
  project.listeners = listenerIds.map((userId) => ({ userId, name: namesById.get(userId) ?? null }));
  return project;
}

export async function listMyProjects(userId: string): Promise<Project[]> {
  const client = requireSupabase();

  const { data: initiated, error: e1 } = await client
    .from("projects")
    .select("*")
    .or(`initiator_id.eq.${userId},mixer_id.eq.${userId}`);
  if (e1) throw e1;

  const { data: assignedTracks, error: e2 } = await client.from("tracks").select("project_id").eq("assigned_user_id", userId);
  if (e2) throw e2;

  const { data: listened, error: e4 } = await client.from("project_listeners").select("project_id").eq("user_id", userId);
  if (e4) throw e4;

  const assignedProjectIds = [...new Set([...(assignedTracks ?? []).map((t) => t.project_id), ...(listened ?? []).map((l) => l.project_id)])];
  let assigned: typeof initiated = [];
  if (assignedProjectIds.length) {
    const { data, error: e3 } = await client.from("projects").select("*").in("id", assignedProjectIds);
    if (e3) throw e3;
    assigned = data ?? [];
  }

  const byId = new Map<string, (typeof initiated)[number]>();
  for (const p of [...(initiated ?? []), ...assigned]) byId.set(p.id, p);

  return [...byId.values()]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((row) => mapProject(row, [], {}));
}

export async function listPublishedProjects(): Promise<Project[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapProject(row, [], {}));
}

/** Who is in each project, for the cards: the Owner first, then the Mixer, then each channel's player. */
export async function fetchParticipantNames(projects: Project[]): Promise<Record<string, string[]>> {
  if (projects.length === 0) return {};
  const client = requireSupabase();
  const { data: tracks, error } = await client
    .from("tracks")
    .select("project_id, assigned_user_id")
    .in("project_id", projects.map((p) => p.id));
  if (error) throw error;

  const idsByProject: Record<string, string[]> = {};
  for (const p of projects) idsByProject[p.id] = [p.initiatorId, ...(p.mixerId ? [p.mixerId] : [])];
  for (const t of tracks ?? []) if (t.assigned_user_id) idsByProject[t.project_id]?.push(t.assigned_user_id as string);

  const allIds = [...new Set(Object.values(idsByProject).flat())];
  const { data: profiles, error: pe } = await client.from("profiles").select("id, display_name").in("id", allIds);
  if (pe) throw pe;
  const nameOf = new Map((profiles ?? []).map((r) => [r.id as string, (r.display_name as string | null) ?? null]));

  const result: Record<string, string[]> = {};
  for (const [projectId, ids] of Object.entries(idsByProject)) {
    result[projectId] = [...new Set(ids)].map((id) => nameOf.get(id)).filter((n): n is string => !!n);
  }
  return result;
}

export async function createProject(title: string, initiatorId: string): Promise<Project> {
  const client = requireSupabase();
  const id = crypto.randomUUID();
  // Insert without chaining .select() — INSERT ... RETURNING evaluates the
  // SELECT policy against the row while it's still being created, which
  // hits an edge case with our participant-visibility policies. Inserting
  // and then reading the row back as a separate statement (proven correct
  // via direct testing) sidesteps that entirely.
  const { error: insertError } = await client.from("projects").insert({ id, title, initiator_id: initiatorId });
  if (insertError) throw insertError;
  const { data, error } = await client.from("projects").select("*").eq("id", id).single();
  if (error) throw error;
  return mapProject(data, [], {});
}

export async function setTempo(projectId: string, bpm: number): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("projects").update({ bpm, updated_at: new Date().toISOString() }).eq("id", projectId);
  if (error) throw error;
}

/** Every file under one folder of a bucket (one level), following the 1000-per-page limit. */
async function listFolderFiles(bucket: string, folder: string): Promise<string[]> {
  const client = requireSupabase();
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000, offset });
    if (error) throw error;
    const page = data ?? [];
    // Entries without an id are sub-folders; callers handle those separately.
    names.push(...page.filter((f) => f.id).map((f) => `${folder}/${f.name}`));
    if (page.length < 1000) return names;
  }
}

/**
 * Owner only, irreversible. Removes every recording file in the project's folder (found by listing the
 * folder in storage, not from the channels on screen, so nothing is missed), then the cover, then the
 * project row — which cascades to channels, takes, clips, invites and listeners.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const client = requireSupabase();
  const { data: trackFolders, error: listError } = await client.storage.from("takes").list(projectId, { limit: 1000 });
  if (listError) throw listError;
  for (const entry of trackFolders ?? []) {
    const files = entry.id ? [`${projectId}/${entry.name}`] : await listFolderFiles("takes", `${projectId}/${entry.name}`);
    if (files.length) {
      const { error } = await client.storage.from("takes").remove(files);
      if (error) throw error;
    }
  }
  const covers = await listFolderFiles("covers", projectId);
  if (covers.length) await client.storage.from("covers").remove(covers);
  const { error } = await client.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

/** Owner: saves a new cover image (already shrunk) and removes the previous file. Returns the new path. */
export async function setProjectCover(projectId: string, image: Blob, previousPath: string | null): Promise<string> {
  const client = requireSupabase();
  const path = `${projectId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await client.storage.from("covers").upload(path, image, { contentType: "image/jpeg", upsert: false });
  if (uploadError) throw uploadError;
  const { error } = await client.from("projects").update({ cover_path: path }).eq("id", projectId);
  if (error) {
    await client.storage.from("covers").remove([path]);
    throw error;
  }
  if (previousPath) await client.storage.from("covers").remove([previousPath]);
  return path;
}

export async function removeProjectCover(projectId: string, path: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("projects").update({ cover_path: null }).eq("id", projectId);
  if (error) throw error;
  await client.storage.from("covers").remove([path]);
}

/** Short-lived links to cover images (the bucket is private), keyed by project id. */
export async function fetchCoverUrls(projects: Pick<Project, "id" | "coverPath">[]): Promise<Record<string, string>> {
  const withCover = projects.filter((p) => p.coverPath);
  if (withCover.length === 0) return {};
  const client = requireSupabase();
  const { data, error } = await client.storage.from("covers").createSignedUrls(
    withCover.map((p) => p.coverPath as string),
    3600
  );
  if (error) throw error;
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  const out: Record<string, string> = {};
  for (const p of withCover) {
    const url = byPath.get(p.coverPath as string);
    if (url) out[p.id] = url;
  }
  return out;
}

export async function renameProject(projectId: string, title: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("projects").update({ title, updated_at: new Date().toISOString() }).eq("id", projectId);
  if (error) throw error;
}

/** Takes a song back to a draft: it leaves the Songs list and only its people can see it again. */
export async function unpublishProject(projectId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("projects").update({ status: "draft", published_at: null }).eq("id", projectId);
  if (error) throw error;
}

export async function publishProject(projectId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from("projects")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

export async function addTrack(
  projectId: string,
  instrument: string,
  color: string,
  position: number,
  assignedUserId: string | null = null,
  assignedName: string | null = null
): Promise<Track> {
  const client = requireSupabase();
  const id = crypto.randomUUID();
  const { error: insertError } = await client
    .from("tracks")
    .insert({ id, project_id: projectId, instrument, color, position, ...(assignedUserId ? { assigned_user_id: assignedUserId } : {}) });
  if (insertError) throw insertError;
  const { data, error } = await client.from("tracks").select("*").eq("id", id).single();
  if (error) throw error;
  return mapTrack(data, [], assignedUserId ? assignedName : null);
}

/** Saves the default channel order (initiator only): each channel's position becomes its place in the list. */
export async function setTrackOrder(orderedIds: string[]): Promise<void> {
  const client = requireSupabase();
  const results = await Promise.all(orderedIds.map((id, position) => client.from("tracks").update({ position }).eq("id", id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

export async function removeTrack(trackId: string): Promise<void> {
  const client = requireSupabase();
  const { error, count } = await client.from("tracks").delete({ count: "exact" }).eq("id", trackId);
  if (error) throw error;
  // The database silently skips rows it won't let you delete, so check that one really went.
  if (count === 0) throw new Error("The channel was not removed (it may still have recordings, or you're not the initiator).");
}

/** The saved final mix. Only the initiator may change it (enforced by the database). */
export async function updateTrackMix(trackId: string, patch: Partial<{ volume: number; muted: boolean; pan: number }>): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("tracks").update(patch).eq("id", trackId);
  if (error) throw error;
}

/** The saved final mix's insert effects (EQ/Comp/Delay/Reverb). Owner/Mixer only, enforced by RLS. */
export async function updateTrackFx(trackId: string, patch: Partial<ChannelFx>): Promise<void> {
  const client = requireSupabase();
  const row: Record<string, number> = {};
  if (patch.eqLow !== undefined) row.eq_low = patch.eqLow;
  if (patch.eqMid !== undefined) row.eq_mid = patch.eqMid;
  if (patch.eqHigh !== undefined) row.eq_high = patch.eqHigh;
  if (patch.compAmount !== undefined) row.comp_amount = patch.compAmount;
  if (patch.delayTimeMs !== undefined) row.delay_time_ms = patch.delayTimeMs;
  if (patch.delayMix !== undefined) row.delay_mix = patch.delayMix;
  if (patch.reverbMix !== undefined) row.reverb_mix = patch.reverbMix;
  const { error } = await client.from("tracks").update(row).eq("id", trackId);
  if (error) throw error;
}

/** The initiator takes an unassigned channel to play it themselves. */
export async function claimOwnTrack(trackId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("claim_own_track", { p_track_id: trackId });
  if (error) throw error;
}

/** Owner assigns an unclaimed channel straight to a known user id — no invite/accept step. */
export async function assignTrackToUser(trackId: string, userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("assign_track_to_user", { p_track_id: trackId, p_user_id: userId });
  if (error) throw error;
}

/** Owner hands a claimed channel to someone else (or null = unclaimed). The database refuses if it has clips. */
export async function reassignTrack(trackId: string, userId: string | null): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("reassign_track", { p_track_id: trackId, p_user_id: userId });
  if (error) throw error;
}

/** Owner adds someone who already has an account straight into the project. */
export async function addProjectMember(projectId: string, userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("add_project_member", { p_project_id: projectId, p_user_id: userId });
  if (error) throw error;
}

export interface ProfileMatch {
  id: string;
  displayName: string | null;
}

/** Narrow, single-purpose lookup by exact email — never a directory, never a full row. */
export async function findProfileByEmail(email: string): Promise<ProfileMatch | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("find_profile_by_email", { p_email: email });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { id: row.id as string, displayName: (row.display_name as string | null) ?? null };
}

/** Uploads the audio and records it as a take. Nothing is placed on the timeline yet — that's a clip. */
export async function createTake(params: {
  projectId: string;
  trackId: string;
  blob: Blob;
  durationSec: number;
  userId: string;
}): Promise<Take> {
  const client = requireSupabase();
  const takeId = crypto.randomUUID();
  const storagePath = `${params.projectId}/${params.trackId}/${takeId}.wav`;

  const { error: uploadError } = await client.storage
    .from("takes")
    .upload(storagePath, params.blob, { contentType: "audio/wav", upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await client.from("takes").insert({
    id: takeId,
    track_id: params.trackId,
    storage_path: storagePath,
    duration_sec: params.durationSec,
    created_by: params.userId,
  });
  if (error) throw error;

  return {
    id: takeId,
    trackId: params.trackId,
    storagePath,
    blob: params.blob,
    durationSec: params.durationSec,
    createdBy: params.userId,
    createdAt: Date.now(),
  };
}

/** Insert or update clips of one channel (no read-back needed: ids are made client-side). */
export async function upsertClips(trackId: string, clips: Clip[]): Promise<void> {
  if (clips.length === 0) return;
  const client = requireSupabase();
  const rows = clips.map((c) => ({
    id: c.id,
    track_id: trackId,
    take_id: c.takeId,
    start_sec: c.startSec,
    source_start_sec: c.sourceStartSec,
    duration_sec: c.durationSec,
    z: c.z,
  }));
  const { error } = await client.from("clips").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteClips(clipIds: string[]): Promise<void> {
  if (clipIds.length === 0) return;
  const client = requireSupabase();
  const { error } = await client.from("clips").delete().in("id", clipIds);
  if (error) throw error;
}

export async function downloadTakeBlob(storagePath: string): Promise<Blob> {
  const client = requireSupabase();
  const { data, error } = await client.storage.from("takes").download(storagePath);
  if (error) throw error;
  return data;
}

/** Downloads the audio of every take used in the song (skipping ones already cached), in place. */
export async function hydrateTakeBlobs(project: Project): Promise<void> {
  await Promise.all(
    Object.values(project.takes).map(async (take) => {
      if (!take.blob) take.blob = await downloadTakeBlob(take.storagePath);
    })
  );
}

export async function createTrackInvite(trackId: string, userId: string): Promise<string> {
  const client = requireSupabase();
  const token = crypto.randomUUID();
  // Known client-side, so no need to read the row back at all.
  const { error } = await client.from("track_invites").insert({ track_id: trackId, created_by: userId, token });
  if (error) throw error;
  return token;
}

export interface InviteDetails {
  trackId: string;
  instrument: string;
  status: string;
  projectId: string;
  projectTitle: string;
}

export async function getInviteDetails(token: string): Promise<InviteDetails | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_invite_details", { p_token: token });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    trackId: row.track_id,
    instrument: row.instrument,
    status: row.invite_status,
    projectId: row.project_id,
    projectTitle: row.project_title,
  };
}

/** Returns the claimed track's id. */
export async function acceptTrackInvite(token: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("accept_track_invite", { p_token: token });
  if (error) throw error;
  return data as string;
}

/** One take's record (used when someone else's clip arrives live). */
export async function fetchTake(takeId: string): Promise<Take> {
  const client = requireSupabase();
  const { data, error } = await client.from("takes").select("*").eq("id", takeId).single();
  if (error) throw error;
  return mapTake(data);
}

export async function fetchDisplayName(userId: string): Promise<string | null> {
  const client = requireSupabase();
  const { data, error } = await client.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | null) ?? null;
}

/** The initiator's saved channel colour (everyone sees it). */
export async function updateTrackColor(trackId: string, color: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("tracks").update({ color }).eq("id", trackId);
  if (error) throw error;
}

export async function updateTrackInstrument(trackId: string, instrument: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("tracks").update({ instrument }).eq("id", trackId);
  if (error) throw error;
}

export async function listTrackFiles(projectId: string, trackId: string): Promise<StoredFile[]> {
  const client = requireSupabase();
  const { data, error } = await client.storage.from("takes").list(`${projectId}/${trackId}`, { limit: 1000 });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.name.endsWith(".wav"))
    .map((f) => ({ name: f.name, createdAtMs: f.created_at ? new Date(f.created_at).getTime() : Date.now() }));
}

export async function removeTakeFiles(projectId: string, trackId: string, fileNames: string[]): Promise<void> {
  if (fileNames.length === 0) return;
  const client = requireSupabase();
  const { error } = await client.storage.from("takes").remove(fileNames.map((n) => `${projectId}/${trackId}/${n}`));
  if (error) throw error;
}

/** Deletes take rows (their audio files are removed separately). Only takes no clip uses should be passed. */
export async function deleteTakeRows(trackId: string, takeIds: string[]): Promise<void> {
  if (takeIds.length === 0) return;
  const client = requireSupabase();
  const { error } = await client.from("takes").delete().eq("track_id", trackId).in("id", takeIds);
  if (error) throw error;
}

// ---- Roles: mixer and listeners -------------------------------------------------

export type InviteRole = "mixer" | "listener";

export async function createProjectInvite(projectId: string, role: InviteRole, userId: string): Promise<string> {
  const client = requireSupabase();
  const token = crypto.randomUUID();
  const { error } = await client.from("project_invites").insert({ project_id: projectId, role, token, created_by: userId });
  if (error) throw error;
  return token;
}

export interface ProjectInviteDetails {
  projectId: string;
  projectTitle: string;
  role: InviteRole;
  status: string;
}

export async function getProjectInviteDetails(token: string): Promise<ProjectInviteDetails | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_project_invite_details", { p_token: token });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { projectId: row.project_id, projectTitle: row.project_title, role: row.role, status: row.invite_status };
}

/** Returns the song's id. */
export async function acceptProjectInvite(token: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("accept_project_invite", { p_token: token });
  if (error) throw error;
  return data as string;
}

/** Owner picks a participant as the mixer, or clears it with null. */
export async function setMixer(projectId: string, userId: string | null): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("set_mixer", { p_project_id: projectId, p_user_id: userId });
  if (error) throw error;
}

export async function removeListener(projectId: string, userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("project_listeners").delete().eq("project_id", projectId).eq("user_id", userId);
  if (error) throw error;
}

export async function fetchListeners(projectId: string): Promise<{ userId: string; name: string | null }[]> {
  const client = requireSupabase();
  const { data, error } = await client.from("project_listeners").select("user_id").eq("project_id", projectId);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.user_id as string);
  if (ids.length === 0) return [];
  const { data: profiles, error: pe } = await client.from("profiles").select("id, display_name").in("id", ids);
  if (pe) throw pe;
  const names = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  return ids.map((userId) => ({ userId, name: names.get(userId) ?? null }));
}

// ---- Notes ----------------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapNote(row: any, authorName: string | null): ProjectNote {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    authorName,
    body: row.body,
    atBeat: row.at_beat ?? null,
    trackId: row.track_id ?? null,
    mentions: (row.mentions as string[] | null) ?? [],
    sharedWithListeners: !!row.shared_with_listeners,
    done: !!row.done,
    doneBy: row.done_by ?? null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** The notes this person is allowed to see (the database filters them), oldest first, with author names. */
export async function listNotes(projectId: string): Promise<ProjectNote[]> {
  const client = requireSupabase();
  const { data, error } = await client.from("project_notes").select("*").eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.author_id as string))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profiles, error: pe } = await client.from("profiles").select("id, display_name").in("id", ids);
    if (pe) throw pe;
    for (const p of profiles ?? []) names.set(p.id as string, (p.display_name as string | null) ?? null);
  }
  return rows.map((r) => mapNote(r, names.get(r.author_id as string) ?? null));
}

export async function createNote(note: {
  projectId: string;
  authorId: string;
  body: string;
  atBeat: number | null;
  trackId: string | null;
  mentions: string[];
  sharedWithListeners: boolean;
}): Promise<string> {
  const client = requireSupabase();
  const id = crypto.randomUUID();
  const { error } = await client.from("project_notes").insert({
    id,
    project_id: note.projectId,
    author_id: note.authorId,
    body: note.body,
    at_beat: note.atBeat,
    track_id: note.trackId,
    mentions: note.mentions,
    shared_with_listeners: note.sharedWithListeners,
  });
  if (error) throw error;
  return id;
}

export async function updateNote(
  id: string,
  patch: Partial<{ body: string; atBeat: number | null; trackId: string | null; mentions: string[]; sharedWithListeners: boolean; done: boolean }>
): Promise<void> {
  const client = requireSupabase();
  const row: Record<string, unknown> = {};
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.atBeat !== undefined) row.at_beat = patch.atBeat;
  if (patch.trackId !== undefined) row.track_id = patch.trackId;
  if (patch.mentions !== undefined) row.mentions = patch.mentions;
  if (patch.sharedWithListeners !== undefined) row.shared_with_listeners = patch.sharedWithListeners;
  if (patch.done !== undefined) row.done = patch.done;
  const { error } = await client.from("project_notes").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("project_notes").delete().eq("id", id);
  if (error) throw error;
}
