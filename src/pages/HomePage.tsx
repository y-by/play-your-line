import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { SignInGate } from "../components/SignInGate";
import { listMyProjects, createProject, fetchParticipantNames, fetchCoverUrls } from "../lib/projectApi";
import type { Project } from "../types/project";
import { ProjectCover } from "../components/ProjectCover";
import { WaveformIcon, PlusCircleIcon, GlobeIcon } from "../components/icons/Icons";

function HomeContent() {
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<Record<string, string[]>>({});
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listMyProjects(userId)
      .then((list) => {
        setProjects(list);
        fetchCoverUrls(list).then(setCovers).catch((err) => console.error("Failed to load covers:", err));
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

      <h2 className="home-title">Projects</h2>

      <main className="home-shelves">
        {projects === null && !loadError && <div className="empty-state">Loading your projects…</div>}
        {loadError && <div className="empty-state">{loadError}</div>}
        {projects?.length === 0 && (
          <div className="empty-state">You haven't started or joined a project yet. Create one to get going.</div>
        )}
        {projects && projects.length > 0 && (
          <>
            {[
              { title: "Drafts", large: true, items: projects.filter((p) => p.status !== "published") },
              { title: "Published", large: false, items: projects.filter((p) => p.status === "published") },
            ]
              .filter((shelf) => shelf.items.length > 0)
              .map((shelf) => (
                <section key={shelf.title} className={shelf.large ? "shelf shelf-large" : "shelf"}>
                  <h3>{shelf.title}</h3>
                  <div className="shelf-row">
                    {shelf.items.map((p) => (
                      <Link key={p.id} to={`/song/${p.id}`} className="tile">
                        <ProjectCover id={p.id} imageUrl={covers[p.id]} />
                        <span className="tile-title">{p.title}</span>
                        <span className="tile-people">{people[p.id]?.length ? people[p.id].join(" · ") : "\u00a0"}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
          </>
        )}
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
