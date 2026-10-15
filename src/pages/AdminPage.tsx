import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SignInGate } from "../components/SignInGate";
import { AppShell } from "../components/AppShell";
import { useAuthStore } from "../store/useAuthStore";
import { useAccountStore } from "../store/useAccountStore";
import { fetchCoverUrls } from "../lib/projectApi";
import { errorMessage } from "../lib/errorMessage";
import {
  fetchAdminUsers,
  fetchAdminProjects,
  fetchAdminActivity,
  setUserBlocked,
  forceSignOut,
  setProjectHidden,
  setProjectMixer,
  removeMember,
  transferOwnership,
  adminUnpublish,
  adminDeleteProject,
  type AdminUser,
  type AdminProject,
  type AdminMember,
  type ActivityEvent,
  type ActivityKind,
  type MemberRole,
} from "../lib/adminApi";
import { formatBytes, timeAgo, isOnline } from "../lib/adminFormat";
import { ChevronDownIcon, EyeIcon, RefreshIcon, SearchIcon } from "../components/icons/Icons";

type Tab = "people" | "projects" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "people", label: "People" },
  { id: "projects", label: "Projects" },
  { id: "activity", label: "Activity" },
];

/** Supabase Free plan file storage. */
const STORAGE_LIMIT_BYTES = 1024 ** 3;
const REFRESH_MS = 30_000;

const ROLE_LABEL: Record<MemberRole, string> = { owner: "Owner", mixer: "Mixer", player: "Player", listener: "Listener" };

/** The words between the person and the project, e.g. "recorded on Guitar in". */
function eventVerb(e: ActivityEvent): string {
  const verbs: Record<ActivityKind, string> = {
    "signed-up": "signed up",
    "created-project": "started",
    published: "published",
    recorded: e.detail ? `recorded on ${e.detail} in` : "recorded in",
    "wrote-note": "wrote a note in",
    "joined-project": "joined",
    "added-channel": e.detail ? `got the ${e.detail} channel in` : "got a channel in",
  };
  return verbs[e.kind] ?? e.kind;
}

// ---- Small pieces -----------------------------------------------------------------------------------------------------

function Avatar({ name, online }: { name: string | null; online?: boolean }) {
  const letter = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="adm-avatar" aria-hidden>
      {letter}
      {online && <span className="adm-online-dot" />}
    </span>
  );
}

function Stat({ label, value, sub, meter }: { label: string; value: string; sub?: string; meter?: number }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {meter !== undefined && (
        <span className="adm-meter" aria-hidden>
          <span className={meter > 0.8 ? "adm-meter-fill hot" : "adm-meter-fill"} style={{ width: `${Math.min(100, meter * 100)}%` }} />
        </span>
      )}
      {sub && <span className="adm-stat-sub">{sub}</span>}
    </div>
  );
}

/** An action that asks first: the first press shows the question with a confirm button (and optional text field). */
function Confirm({
  label,
  question,
  confirmLabel,
  danger,
  field,
  mustType,
  onConfirm,
  disabled,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  danger?: boolean;
  field?: string;
  mustType?: string;
  onConfirm: (text: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className={danger ? "adm-btn danger" : "adm-btn"} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </button>
    );
  }
  const ready = !mustType || text.trim() === mustType.trim();
  return (
    <div className={danger ? "adm-confirm danger" : "adm-confirm"}>
      <p>{question}</p>
      {(field || mustType) && (
        <input
          className="adm-input"
          autoFocus
          value={text}
          placeholder={mustType ? `Type “${mustType}”` : field}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <div className="adm-confirm-row">
        <button className="adm-btn" onClick={() => { setOpen(false); setText(""); }} disabled={busy}>
          Cancel
        </button>
        <button
          className={danger ? "adm-btn solid danger" : "adm-btn solid"}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(text);
              setOpen(false);
              setText("");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ---- People -----------------------------------------------------------------------------------------------------------

function PersonRow({
  user,
  me,
  projects,
  open,
  onToggle,
  act,
  onShowProjects,
}: {
  user: AdminUser;
  me: string | null;
  projects: AdminProject[];
  open: boolean;
  onToggle: () => void;
  act: (label: string, run: () => Promise<unknown>) => Promise<void>;
  onShowProjects: () => void;
}) {
  const online = isOnline(user.lastSeenAt);
  const theirs = projects.filter((p) => p.members.some((m) => m.userId === user.userId));
  const isMe = user.userId === me;
  return (
    <li className={open ? "adm-row open" : "adm-row"}>
      <button className="adm-row-head" onClick={onToggle} aria-expanded={open}>
        <Avatar name={user.name} online={online} />
        <span className="adm-row-main">
          <span className="adm-row-title">
            {user.name ?? "No name"}
            {user.isAdmin && <span className="adm-pill accent">Admin</span>}
            {user.blocked && <span className="adm-pill red">Blocked</span>}
          </span>
          <span className="adm-row-sub">
            {online ? (
              <span className="adm-live">
                Online{user.lastProjectTitle ? <> · in {user.lastProjectTitle}</> : null}
              </span>
            ) : (
              <>Last seen {timeAgo(user.lastSeenAt ?? user.lastSignInAt)}</>
            )}
            {user.email && <span className="adm-dim"> · {user.email}</span>}
          </span>
        </span>
        <span className="adm-row-nums">
          <span title="Projects they are in (they own)">
            <b>{user.memberProjects}</b> proj{user.ownedProjects ? ` (${user.ownedProjects} own)` : ""}
          </span>
          <span title="Recordings they made">
            <b>{user.takes}</b> takes
          </span>
          <span title="Storage of their recordings">{formatBytes(user.takesBytes)}</span>
        </span>
        <span className={open ? "adm-chevron open" : "adm-chevron"}>
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {open && (
        <div className="adm-detail">
          <dl className="adm-facts">
            <div><dt>Joined</dt><dd>{new Date(user.joinedAt).toLocaleDateString()}</dd></div>
            <div><dt>Last sign-in</dt><dd>{timeAgo(user.lastSignInAt)}</dd></div>
            <div><dt>Last seen</dt><dd>{timeAgo(user.lastSeenAt)}</dd></div>
            <div><dt>Notes written</dt><dd>{user.notes}</dd></div>
            {user.blocked && (
              <div><dt>Blocked</dt><dd>{timeAgo(user.blockedAt)}{user.blockedReason ? ` — “${user.blockedReason}”` : ""}</dd></div>
            )}
          </dl>

          {theirs.length > 0 && (
            <div className="adm-chips">
              {theirs.map((p) => {
                const m = p.members.find((x) => x.userId === user.userId);
                return (
                  <Link key={p.projectId} to={`/song/${p.projectId}`} className="adm-chip" title="Open as observer">
                    {p.title}
                    <span className="adm-dim"> · {m?.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="adm-actions">
            {theirs.length > 0 && (
              <button className="adm-btn" onClick={onShowProjects}>
                Show their projects
              </button>
            )}
            {!isMe && (
              <Confirm
                label="Sign out everywhere"
                question={`Sign ${user.name ?? "this person"} out on every device now? They can sign in again.`}
                confirmLabel="Sign out"
                onConfirm={() => act("Signed out", () => forceSignOut(user.userId))}
              />
            )}
            {!isMe &&
              (user.blocked ? (
                <Confirm
                  label="Unblock"
                  question={`Let ${user.name ?? "this person"} use Play Your Line again?`}
                  confirmLabel="Unblock"
                  onConfirm={() => act("Unblocked", () => setUserBlocked(user.userId, false))}
                />
              ) : (
                <Confirm
                  label="Block…"
                  danger
                  question={`Block ${user.name ?? "this person"}? They can still sign in, but see and change nothing, and are taken out of any open project at once. Their projects and recordings stay.`}
                  field="Reason (optional, they will see it)"
                  confirmLabel="Block"
                  onConfirm={(reason) => act("Blocked", () => setUserBlocked(user.userId, true, reason))}
                />
              ))}
            {isMe && <span className="adm-dim">This is you.</span>}
          </div>
        </div>
      )}
    </li>
  );
}

// ---- Projects ---------------------------------------------------------------------------------------------------------

function MemberLine({ project, member, act }: { project: AdminProject; member: AdminMember; act: (label: string, run: () => Promise<unknown>) => Promise<void> }) {
  const isOwner = member.roles.includes("owner");
  const isMixer = member.roles.includes("mixer");
  return (
    <li className="adm-member">
      <Avatar name={member.name} />
      <span className="adm-row-main">
        <span className="adm-row-title">{member.name ?? "No name"}</span>
        <span className="adm-row-sub">
          {member.roles.map((r) => (
            <span key={r} className={`adm-role ${r}`}>{ROLE_LABEL[r]}</span>
          ))}
          {member.channels.length > 0 && <span className="adm-dim"> {member.channels.join(", ")}</span>}
        </span>
      </span>
      {!isOwner && (
        <span className="adm-member-actions">
          {isMixer ? (
            <button className="adm-btn small" onClick={() => act("Mixer removed", () => setProjectMixer(project.projectId, null))}>
              Remove Mixer
            </button>
          ) : (
            <button className="adm-btn small" onClick={() => act("Mixer set", () => setProjectMixer(project.projectId, member.userId))}>
              Make Mixer
            </button>
          )}
          <Confirm
            label="Make Owner"
            question={`Make ${member.name ?? "this person"} the Owner of “${project.title}”? The current Owner stays in it as a listener.`}
            confirmLabel="Make Owner"
            onConfirm={() => act("Ownership transferred", () => transferOwnership(project.projectId, member.userId))}
          />
          <Confirm
            label="Remove"
            danger
            question={`Take ${member.name ?? "this person"} out of “${project.title}”? Their channels without recordings become free; channels with recordings stay theirs.`}
            confirmLabel="Remove"
            onConfirm={() =>
              act("Removed", async () => {
                const kept = await removeMember(project.projectId, member.userId);
                if (kept > 0) throw new Error(`Removed, but ${kept} channel${kept === 1 ? "" : "s"} with recordings stay theirs (recordings are never moved).`);
              })
            }
          />
        </span>
      )}
    </li>
  );
}

function ProjectRow({
  project,
  cover,
  open,
  onToggle,
  act,
}: {
  project: AdminProject;
  cover?: string;
  open: boolean;
  onToggle: () => void;
  act: (label: string, run: () => Promise<unknown>) => Promise<void>;
}) {
  const bytes = project.takesBytes + project.otherBytes;
  return (
    <li className={open ? "adm-row open" : "adm-row"}>
      <button className="adm-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="adm-cover" aria-hidden>
          {cover ? <img src={cover} alt="" /> : <span>{project.title.trim().charAt(0).toUpperCase() || "♪"}</span>}
        </span>
        <span className="adm-row-main">
          <span className="adm-row-title">
            {project.title}
            <span className={project.status === "published" ? "adm-pill green" : "adm-pill"}>{project.status === "published" ? "Published" : "Draft"}</span>
            {project.hidden && <span className="adm-pill red">Hidden</span>}
          </span>
          <span className="adm-row-sub">
            {project.ownerName ?? "Unknown"} · {project.members.length} {project.members.length === 1 ? "person" : "people"} · active {timeAgo(project.lastActivity)}
          </span>
        </span>
        <span className="adm-row-nums">
          <span><b>{project.channels}</b> ch</span>
          <span><b>{project.takes}</b> takes</span>
          <span>{formatBytes(bytes)}</span>
        </span>
        <span className={open ? "adm-chevron open" : "adm-chevron"}>
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {open && (
        <div className="adm-detail">
          <dl className="adm-facts">
            <div><dt>Started</dt><dd>{new Date(project.createdAt).toLocaleDateString()}</dd></div>
            <div><dt>Published</dt><dd>{project.publishedAt ? new Date(project.publishedAt).toLocaleDateString() : "—"}</dd></div>
            <div><dt>Clips</dt><dd>{project.clips}</dd></div>
            <div><dt>Notes</dt><dd>{project.notes}</dd></div>
            <div><dt>Recordings</dt><dd>{formatBytes(project.takesBytes)}</dd></div>
            <div><dt>Cover + listening copy</dt><dd>{formatBytes(project.otherBytes)}</dd></div>
            <div><dt>Files</dt><dd>{project.files}</dd></div>
          </dl>

          <h4 className="adm-subhead">People</h4>
          <ul className="adm-members">
            {project.members.map((m) => (
              <MemberLine key={m.userId} project={project} member={m} act={act} />
            ))}
          </ul>

          <div className="adm-actions">
            <Link to={`/song/${project.projectId}`} className="adm-btn solid">
              <EyeIcon size={14} /> Observe
            </Link>
            {project.status === "published" && (
              <Confirm
                label="Unpublish"
                question={`Take “${project.title}” off the Published list and back to a draft? Its listening copy is removed.`}
                confirmLabel="Unpublish"
                onConfirm={() => act("Unpublished", () => adminUnpublish(project.projectId))}
              />
            )}
            {project.hidden ? (
              <button className="adm-btn" onClick={() => act("Visible again", () => setProjectHidden(project.projectId, false))}>
                Unhide
              </button>
            ) : (
              <Confirm
                label="Hide"
                question={`Hide “${project.title}” from everyone outside it (and from the Published list)? Its people still see it. Nothing is deleted.`}
                confirmLabel="Hide"
                onConfirm={() => act("Hidden", () => setProjectHidden(project.projectId, true))}
              />
            )}
            <Confirm
              label="Delete…"
              danger
              question={`Delete “${project.title}” for good: every recording file, the cover, the listening copy, all channels, clips and notes. This cannot be undone.`}
              mustType={project.title}
              confirmLabel="Delete forever"
              onConfirm={() => act("Deleted", () => adminDeleteProject(project.projectId))}
            />
          </div>
        </div>
      )}
    </li>
  );
}

// ---- Activity ---------------------------------------------------------------------------------------------------------

function ActivityList({ events }: { events: ActivityEvent[] }) {
  const days = useMemo(() => {
    const out: { day: string; items: ActivityEvent[] }[] = [];
    for (const e of events) {
      const day = new Date(e.at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      if (out.length === 0 || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events]);
  if (events.length === 0) return <div className="empty-state">Nothing matches.</div>;
  return (
    <div className="adm-activity">
      {days.map((d) => (
        <section key={d.day}>
          <h4 className="adm-subhead">{d.day}</h4>
          <ul className="adm-feed">
            {d.items.map((e, i) => (
              <li key={`${e.at}-${i}`} className={`adm-event ${e.kind}`}>
                <time>{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</time>
                <span className="adm-event-dot" aria-hidden />
                <span>
                  <b>{e.userName ?? "Someone"}</b> {eventVerb(e)}{" "}
                  {e.projectId && (
                    <Link to={`/song/${e.projectId}`} className="adm-link">
                      {e.projectTitle ?? "a deleted project"}
                    </Link>
                  )}
                  {e.kind === "wrote-note" && e.detail && <span className="adm-dim"> — “{e.detail}”</span>}
                  {e.kind === "joined-project" && e.detail && <span className="adm-dim"> {e.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---- The page ---------------------------------------------------------------------------------------------------------

function AdminContent() {
  const me = useAuthStore((s) => s.userId);
  const isAdmin = useAccountStore((s) => s.isAdmin);
  const loaded = useAccountStore((s) => s.loaded);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "people") as Tab;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [personFilter, setPersonFilter] = useState<{ id: string; name: string } | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [projects, setProjects] = useState<AdminProject[] | null>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [u, p, a] = await Promise.all([fetchAdminUsers(), fetchAdminProjects(), fetchAdminActivity(200)]);
      setUsers(u);
      setProjects(p);
      setEvents(a);
      setError(null);
      setRefreshedAt(Date.now());
      setNow(Date.now());
      fetchCoverUrls(p.map((x) => ({ id: x.projectId, coverPath: x.coverPath })))
        .then(setCovers)
        .catch(() => {});
    } catch (err) {
      setError(`Couldn't load the dashboard: ${errorMessage(err, "unknown error")}. If this is the first time, run migration 0046 in Supabase.`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    // The first load waits a tick so the effect itself sets no state.
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [isAdmin, refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.bad ? 7000 : 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
        setToast({ text: label });
      } catch (err) {
        setToast({ text: errorMessage(err, "That didn't work"), bad: true });
      }
      await refresh();
    },
    [refresh]
  );

  const setTab = (next: Tab) => {
    setParams(next === "people" ? {} : { tab: next }, { replace: true });
    setFilter("all");
    setOpenId(null);
  };

  const q = query.trim().toLowerCase();
  const shownUsers = useMemo(
    () =>
      (users ?? []).filter((u) => {
        if (filter === "online" && !isOnline(u.lastSeenAt)) return false;
        if (filter === "blocked" && !u.blocked) return false;
        if (filter === "new" && now - new Date(u.joinedAt).getTime() > 7 * 86400_000) return false;
        return !q || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q);
      }),
    [users, filter, q, now]
  );
  const shownProjects = useMemo(
    () =>
      (projects ?? []).filter((p) => {
        if (personFilter && !p.members.some((m) => m.userId === personFilter.id)) return false;
        if (filter === "published" && p.status !== "published") return false;
        if (filter === "draft" && p.status !== "draft") return false;
        if (filter === "hidden" && !p.hidden) return false;
        return !q || `${p.title} ${p.ownerName ?? ""} ${p.members.map((m) => m.name).join(" ")}`.toLowerCase().includes(q);
      }),
    [projects, filter, q, personFilter]
  );
  const shownEvents = useMemo(
    () =>
      (events ?? []).filter((e) => {
        if (filter !== "all" && e.kind !== filter) return false;
        return !q || `${e.userName ?? ""} ${e.projectTitle ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q);
      }),
    [events, filter, q]
  );

  if (!loaded) return <div className="empty-state">Checking your access…</div>;
  if (!isAdmin) {
    return <div className="empty-state">This page is only for the system owner.</div>;
  }

  const online = (users ?? []).filter((u) => isOnline(u.lastSeenAt, now));
  const totalBytes = (projects ?? []).reduce((sum, p) => sum + p.takesBytes + p.otherBytes, 0);
  const published = (projects ?? []).filter((p) => p.status === "published").length;
  const hidden = (projects ?? []).filter((p) => p.hidden).length;
  const blocked = (users ?? []).filter((u) => u.blocked).length;
  const newThisWeek = (users ?? []).filter((u) => now - new Date(u.joinedAt).getTime() < 7 * 86400_000).length;
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const takesToday = (events ?? []).filter((e) => e.kind === "recorded" && new Date(e.at).getTime() >= todayStart).length;

  const filters: { id: string; label: string }[] =
    tab === "people"
      ? [
          { id: "all", label: "All" },
          { id: "online", label: `Online ${online.length}` },
          { id: "new", label: "New this week" },
          { id: "blocked", label: `Blocked ${blocked}` },
        ]
      : tab === "projects"
        ? [
            { id: "all", label: "All" },
            { id: "draft", label: "Drafts" },
            { id: "published", label: "Published" },
            { id: "hidden", label: "Hidden" },
          ]
        : [
            { id: "all", label: "All" },
            { id: "recorded", label: "Recordings" },
            { id: "wrote-note", label: "Notes" },
            { id: "created-project", label: "New projects" },
            { id: "signed-up", label: "Sign-ups" },
          ];

  return (
    <main className="adm">
      {error && <p className="assign-error">{error}</p>}

      <section className="adm-stats" aria-label="Summary">
        <Stat label="People" value={users ? String(users.length) : "–"} sub={newThisWeek ? `+${newThisWeek} this week` : "none new this week"} />
        <Stat
          label="Online now"
          value={users ? String(online.length) : "–"}
          sub={online.length ? online.slice(0, 3).map((u) => u.name ?? "?").join(", ") + (online.length > 3 ? "…" : "") : "nobody"}
        />
        <Stat
          label="Projects"
          value={projects ? String(projects.length) : "–"}
          sub={`${published} published${hidden ? ` · ${hidden} hidden` : ""}`}
        />
        <Stat label="Takes today" value={events ? String(takesToday) : "–"} sub="recordings since midnight" />
        <Stat
          label="Storage"
          value={projects ? formatBytes(totalBytes) : "–"}
          meter={projects ? totalBytes / STORAGE_LIMIT_BYTES : undefined}
          sub={`${Math.round((totalBytes / STORAGE_LIMIT_BYTES) * 100)}% of 1 GB (Free plan)`}
        />
      </section>

      <div className="adm-bar">
        <div className="adm-seg" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="adm-search">
          <SearchIcon size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "people" ? "Name or email" : tab === "projects" ? "Title or person" : "Person, project or text"} />
        </label>
        <button className="adm-refresh" onClick={() => void refresh()} disabled={refreshing} title="Refresh now (it also refreshes every 30 seconds)">
          <span className={refreshing ? "spin" : ""}>
            <RefreshIcon size={14} />
          </span>
          {refreshedAt ? timeAgo(new Date(refreshedAt).toISOString(), now) : "…"}
        </button>
      </div>

      <div className="adm-filters">
        {filters.map((f) => (
          <button key={f.id} className={filter === f.id ? "adm-filter active" : "adm-filter"} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        {tab === "projects" && personFilter && (
          <button className="adm-filter active person" onClick={() => setPersonFilter(null)} title="Show everyone's projects">
            {personFilter.name} ✕
          </button>
        )}
      </div>

      {tab === "people" &&
        (users === null ? (
          <div className="empty-state">Loading people…</div>
        ) : shownUsers.length === 0 ? (
          <div className="empty-state">Nobody matches.</div>
        ) : (
          <ul className="adm-list">
            {shownUsers.map((u) => (
              <PersonRow
                key={u.userId}
                user={u}
                me={me}
                projects={projects ?? []}
                open={openId === u.userId}
                onToggle={() => setOpenId(openId === u.userId ? null : u.userId)}
                act={act}
                onShowProjects={() => {
                  setPersonFilter({ id: u.userId, name: u.name ?? "No name" });
                  setTab("projects");
                }}
              />
            ))}
          </ul>
        ))}

      {tab === "projects" &&
        (projects === null ? (
          <div className="empty-state">Loading projects…</div>
        ) : shownProjects.length === 0 ? (
          <div className="empty-state">No project matches.</div>
        ) : (
          <ul className="adm-list">
            {shownProjects.map((p) => (
              <ProjectRow
                key={p.projectId}
                project={p}
                cover={covers[p.projectId]}
                open={openId === p.projectId}
                onToggle={() => setOpenId(openId === p.projectId ? null : p.projectId)}
                act={act}
              />
            ))}
          </ul>
        ))}

      {tab === "activity" && (events === null ? <div className="empty-state">Loading activity…</div> : <ActivityList events={shownEvents} />)}

      {toast && (
        <div className={toast.bad ? "adm-toast bad" : "adm-toast"} role="status">
          {toast.text}
        </div>
      )}
    </main>
  );
}

export function AdminPage() {
  return (
    <SignInGate>
      <AppShell title="Admin">
        <AdminContent />
      </AppShell>
    </SignInGate>
  );
}
