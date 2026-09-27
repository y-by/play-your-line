// Who is what in a song. Pure, so the labels and rules are written once and tested.
//
//   Owner     the initiator: everything, including publishing
//   Mixer     one optional person who sets the final mix (volume, mute)
//   Player    assigned to a channel
//   Listener  invited to hear a draft
export type Role = "owner" | "mixer" | "player" | "listener";

export interface RoleContext {
  initiatorId: string;
  mixerId: string | null;
  listenerIds: string[];
  assignedUserIds: (string | null)[];
}

/** Every role this person holds, most powerful first. */
export function rolesOf(ctx: RoleContext, userId: string | null): Role[] {
  if (!userId) return [];
  const roles: Role[] = [];
  if (ctx.initiatorId === userId) roles.push("owner");
  if (ctx.mixerId === userId) roles.push("mixer");
  if (ctx.assignedUserIds.includes(userId)) roles.push("player");
  if (ctx.listenerIds.includes(userId)) roles.push("listener");
  return roles;
}

const LABELS: Record<Role, string> = { owner: "Owner", mixer: "Mixer", player: "Player", listener: "Listener" };

/**
 * A short label for the small badge. The Owner is always just "Owner" (they can
 * do everything already); otherwise the roles are listed, e.g. "Mixer · Player".
 */
export function roleBadge(roles: Role[]): string | null {
  if (roles.length === 0) return null;
  if (roles.includes("owner")) return LABELS.owner;
  return roles.map((r) => LABELS[r]).join(" · ");
}

/** May this person set the saved final mix? The Owner and the Mixer. */
export function canMixFinal(ctx: Pick<RoleContext, "initiatorId" | "mixerId">, userId: string | null): boolean {
  return !!userId && (ctx.initiatorId === userId || ctx.mixerId === userId);
}
