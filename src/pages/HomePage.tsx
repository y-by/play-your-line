import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { SignInGate } from "../components/SignInGate";
import { listMyProjects, createProject, fetchParticipantNames } from "../lib/projectApi";
import type { Project } from "../types/project";
import { WaveformIcon, PlusCircleIcon, GlobeIcon } from "../components/icons/Icons";

function HomeContent() {
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<Record<string, string[]>>({});
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listMyProjects(userId)
      .then((list) => {
        setProjects(list);
        fetchParticipantNames(list).then(setPeople).catch((err) => console.error("Failed to load participant names:", err));
      })
      .catch((err) => {
        console.error("Failed to load your projects:", err);
        const detail = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
        setLoadError(`Couldn't load your projects${detail ? ` (${detail})` : ""}. If you just updated the app, the latest database step may not have been run yet.`);
      });
  }, [userId]);

  const handleCreate = async () => {
    if (!userId) return;
    setCreating(true);
    try {
      const project = await createProject("Untitled Project", userId);
      navigate(`/song/${project.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="header-icon">
            <WaveformIcon size={22} />
          </span>
          Play Your Line
        </h1>
        {profile?.displayName && <span className="project-title">{profile.displayName}</span>}
        <button className="icon-btn-text" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="home-actions">
        <button className="export-btn" onClick={handleCreate} disabled={creating}>
          <PlusCircleIcon size={14} />
          {creating ? "Creating…" : "New Project"}
        </button>
        <Link to="/songs" className="link-btn">
          <GlobeIcon size={14} />
          Browse Published Projects
        </Link>
      </div>

      <main className="track-list">
        {projects === null && !loadError && <div className="empty-state">Loading your projects…</div>}
        {loadError && <div className="empty-state">{loadError}</div>}
        {projects?.length === 0 && (
          <div className="empty-state">You haven't started or joined a project yet. Create one to get going.</div>
        )}
        {projects?.map((p) => (
          <Link key={p.id} to={`/song/${p.id}`} className="song-list-item">
            <span className="song-list-main">
              <span className="song-list-title">{p.title}</span>
              {people[p.id]?.length > 0 && <span className="song-list-people">{people[p.id].join(" · ")}</span>}
            </span>
            <span className={p.status === "published" ? "song-list-status published" : "song-list-status"}>
              {p.status === "published" ? "Published" : "Draft"}
            </span>
          </Link>
        ))}
      </main>
    </div>
  );
}

export function HomePage() {
  return (
    <SignInGate>
      <HomeContent />
    </SignInGate>
  );
}
