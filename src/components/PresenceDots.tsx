import { useProjectStore } from "../store/useProjectStore";
import { useAuthStore } from "../store/useAuthStore";

const MAX_SHOWN = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Small circles for everyone who has this project open right now. */
export function PresenceDots() {
  const users = useProjectStore((s) => s.presentUsers);
  const me = useAuthStore((s) => s.userId);
  if (users.length === 0) return null;

  // You first, then everyone else.
  const sorted = [...users].sort((a, b) => Number(b.userId === me) - Number(a.userId === me));
  const shown = sorted.slice(0, MAX_SHOWN);
  const extra = sorted.length - shown.length;

  return (
    <div className="presence" title={`Here now: ${sorted.map((u) => (u.userId === me ? "you" : u.name)).join(", ")}`}>
      {shown.map((u) => (
        <span key={u.userId} className={u.userId === me ? "presence-dot me" : "presence-dot"}>
          {initials(u.name)}
        </span>
      ))}
      {extra > 0 && <span className="presence-dot more">+{extra}</span>}
    </div>
  );
}
