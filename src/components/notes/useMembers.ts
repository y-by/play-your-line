import { useMemo } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import type { Member } from "../../lib/notes";

/** Everyone in the project who can be tagged in a note: the Owner, players, the Mixer and listeners. */
export function useMembers(): Member[] {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!project) return [];
    const byId = new Map<string, string>();
    const add = (id: string | null, name: string | null) => {
      if (id && !byId.has(id)) byId.set(id, name?.trim() || "Player");
    };
    add(project.initiatorId, project.initiatorName);
    for (const t of project.tracks) add(t.assignedUserId, t.assignedPlayerName);
    add(project.mixerId, project.mixerName);
    for (const l of project.listeners) add(l.userId, l.name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [project]);
}
