import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { createProject } from "../lib/projectApi";
import { errorMessage } from "../lib/errorMessage";
import { GlobeIcon, HelpIcon, HomeIcon, PlusCircleIcon, UserIcon, WaveformIcon } from "./icons/Icons";

/**
 * The frame around the project lists: a side menu on desktop, a tab bar at the bottom on phones.
 * (The project editor keeps its own full-width layout.)
 */
export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [youOpen, setYouOpen] = useState(false);

  const handleCreate = async () => {
    if (!userId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject("Untitled Project", userId);
      navigate(`/song/${project.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      setCreateError(`Couldn't create the project: ${errorMessage(err, "try again")}`);
    } finally {
      setCreating(false);
    }
  };

  const name = profile?.displayName ?? "You";

  return (
    <div className="shell">
      <aside className="shell-side" aria-label="Menu">
        <div className="shell-brand">
          <span className="header-icon">
            <WaveformIcon size={20} />
          </span>
          Play Your Line
        </div>
        <nav className="shell-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
            <HomeIcon size={18} />
            Projects
          </NavLink>
          <NavLink to="/songs" className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
            <GlobeIcon size={18} />
            Published
          </NavLink>
          <NavLink to="/help" className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
            <HelpIcon size={18} />
            Help
          </NavLink>
        </nav>
        <button className="export-btn shell-new" onClick={handleCreate} disabled={creating}>
          <PlusCircleIcon size={14} />
          {creating ? "Creating…" : "New Project"}
        </button>
        <div className="shell-user">
          <span className="shell-user-name">{name}</span>
          <button className="icon-btn-text" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-head">
          <h1>{title}</h1>
          <button className="shell-avatar" onClick={() => setYouOpen(true)} aria-label="Account">
            {name.trim().charAt(0).toUpperCase() || "Y"}
          </button>
        </header>
        {createError && <p className="assign-error">{createError}</p>}
        {children}
      </div>

      {youOpen && (
        <div className="shell-sheet-backdrop" onClick={() => setYouOpen(false)}>
          <div className="shell-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Account">
            <span className="shell-user-name">{name}</span>
            <NavLink to="/help" className="link-btn" onClick={() => setYouOpen(false)}>
              Help
            </NavLink>
            <button className="link-btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      )}

      <nav className="shell-tabs" aria-label="Menu">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "shell-tab active" : "shell-tab")}>
          <HomeIcon />
          <span>Projects</span>
        </NavLink>
        <button className="shell-tab shell-tab-new" onClick={handleCreate} disabled={creating} aria-label="New project">
          <PlusCircleIcon size={26} />
          <span>New</span>
        </button>
        <NavLink to="/songs" className={({ isActive }) => (isActive ? "shell-tab active" : "shell-tab")}>
          <GlobeIcon size={20} />
          <span>Published</span>
        </NavLink>
        <button className={youOpen ? "shell-tab active" : "shell-tab"} onClick={() => setYouOpen((v) => !v)}>
          <UserIcon />
          <span>You</span>
        </button>
      </nav>
    </div>
  );
}
