// The owner dashboard's calls (migration 0046). Every admin_* function checks inside the database that the caller is
// the system owner (`user_status.is_admin`), so these wrappers add no security of their own.
import { supabase } from "./supabaseClient";
import { deleteProject } from "./projectApi";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

// ---- The signed-in person's own status (everyone) ---------------------------------------------------------------------

export interface AccountStatus {
  isAdmin: boolean;
  blocked: boolean;
  blockedReason: string | null;
  signoutAfter: string | null;
}

const NO_STATUS: AccountStatus = { isAdmin: false, blocked: false, blockedReason: null, signoutAfter: null };

/** True when the error is the database refusing a blocked account (see `pyl_pre_request` in 0046). */
export function isBlockedError(err: unknown): boolean {
  const text = err && typeof err === "object" ? `${(err as { message?: string }).message ?? ""} ${(err as { hint?: string }).hint ?? ""}` : "";
  return text.includes("account_blocked");
}

/** Before migration 0046 is run the function doesn't exist; that reads as "nothing special about this account". */
export async function fetchAccountStatus(): Promise<AccountStatus> {
  const { data, error } = await client().rpc("my_account_status");
  if (error) {
    if (isBlockedError(error)) return { ...NO_STATUS, blocked: true };
    return NO_STATUS;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NO_STATUS;
  return {
    isAdmin: !!row.is_admin,
    blocked: !!row.blocked,
    blockedReason: row.blocked_reason ?? null,
    signoutAfter: row.signout_after ?? null,
  };
}

/** "I'm here (in this project)". Best effort: silently does nothing before 0046. */
export async function touchLastSeen(projectId: string | null): Promise<void> {
  await client().rpc("touch_last_seen", { p_project_id: projectId });
}

// ---- Admin: reading ---------------------------------------------------------------------------------------------------

export interface AdminUser {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  lastProjectId: string | null;
  lastProjectTitle: string | null;
  isAdmin: boolean;
  blocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  ownedProjects: number;
  memberProjects: number;
  takes: number;
  takesBytes: number;
  notes: number;
}

export type MemberRole = "owner" | "mixer" | "player" | "listener";

export interface AdminMember {
  userId: string;
  name: string | null;
  roles: MemberRole[];
  channels: string[];
  canPlay: boolean;
}

export interface AdminProject {
  projectId: string;
  title: string;
  status: "draft" | "published";
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  coverPath: string | null;
  ownerId: string;
  ownerName: string | null;
  mixerId: string | null;
  channels: number;
  clips: number;
  takes: number;
  notes: number;
  takesBytes: number;
  otherBytes: number;
  files: number;
  members: AdminMember[];
  lastActivity: string | null;
}

export type ActivityKind = "signed-up" | "created-project" | "published" | "recorded" | "wrote-note" | "joined-project" | "added-channel";

export interface ActivityEvent {
  at: string;
  kind: ActivityKind;
  userId: string | null;
  userName: string | null;
  projectId: string | null;
  projectTitle: string | null;
  detail: string | null;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await client().rpc("admin_users");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    name: r.display_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    joinedAt: r.joined_at,
    lastSignInAt: r.last_sign_in_at,
    lastSeenAt: r.last_seen_at,
    lastProjectId: r.last_project_id,
    lastProjectTitle: r.last_project_title,
    isAdmin: !!r.is_admin,
    blocked: !!r.blocked,
    blockedReason: r.blocked_reason,
    blockedAt: r.blocked_at,
    ownedProjects: num(r.owned_projects),
    memberProjects: num(r.member_projects),
    takes: num(r.takes),
    takesBytes: num(r.takes_bytes),
    notes: num(r.notes),
  }));
}

export async function fetchAdminProjects(): Promise<AdminProject[]> {
  const { data, error } = await client().rpc("admin_projects");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    projectId: r.project_id,
    title: r.title,
    status: r.status,
    hidden: !!r.hidden,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
    coverPath: r.cover_path,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    mixerId: r.mixer_id,
    channels: num(r.channels),
    clips: num(r.clips),
    takes: num(r.takes),
    notes: num(r.notes),
    takesBytes: num(r.takes_bytes),
    otherBytes: num(r.other_bytes),
    files: num(r.files),
    members: Array.isArray(r.members) ? r.members : [],
    lastActivity: r.last_activity,
  }));
}

export async function fetchAdminActivity(limit = 150): Promise<ActivityEvent[]> {
  const { data, error } = await client().rpc("admin_activity", { p_limit: limit });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    at: r.at,
    kind: r.kind,
    userId: r.user_id,
    userName: r.user_name,
    projectId: r.project_id,
    projectTitle: r.project_title,
    detail: r.detail,
  }));
}

// ---- Admin: control ---------------------------------------------------------------------------------------------------

async function call(fn: string, args: Record<string, unknown>) {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw error;
  return data;
}

export const setUserBlocked = (userId: string, blocked: boolean, reason?: string) =>
  call("admin_set_blocked", { p_user_id: userId, p_blocked: blocked, p_reason: reason ?? null });

export const forceSignOut = (userId: string) => call("admin_force_signout", { p_user_id: userId });

export const setProjectHidden = (projectId: string, hidden: boolean) => call("admin_set_hidden", { p_project_id: projectId, p_hidden: hidden });

export const setProjectMixer = (projectId: string, userId: string | null) => call("admin_set_mixer", { p_project_id: projectId, p_user_id: userId });

/** Returns how many of the person's channels stayed theirs because they hold recordings. */
export async function removeMember(projectId: string, userId: string): Promise<number> {
  return num(await call("admin_remove_member", { p_project_id: projectId, p_user_id: userId }));
}

export const transferOwnership = (projectId: string, userId: string) => call("admin_transfer_ownership", { p_project_id: projectId, p_user_id: userId });

/** Back to a draft, then the listening copy's file goes (a failure there leaves only an unused file behind). */
export async function adminUnpublish(projectId: string): Promise<void> {
  const previewPath = (await call("admin_unpublish", { p_project_id: projectId })) as string | null;
  if (previewPath) {
    const { error } = await client().storage.from("previews").remove([previewPath]);
    if (error) console.error("Couldn't remove the listening copy:", error);
  }
}

/** The same deletion the Owner uses (files first, then the project), allowed to the admin by 0046. */
export const adminDeleteProject = (projectId: string) => deleteProject(projectId);
