import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { SignInGate } from "../components/SignInGate";
import { AppShell } from "../components/AppShell";
import { ProjectCard } from "../components/ProjectCard";
import { listMyProjects, fetchParticipantNames, fetchCoverUrls } from "../lib/projectApi";
import type { Project } from "../types/project";

function HomeContent() {
  const userId = useAuthStore((s) => s.userId);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<Record<string, string[]>>({});
  const [covers, setCovers] = useState<Record<string, string>>({});
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

  return (
    <AppShell title="Projects">
      <main className="home-shelves">
        {projects === null && !loadError && <div className="empty-state">Loading your projects…</div>}
        {loadError && <div className="empty-state">{loadError}</div>}
        {projects?.length === 0 && (
          <div className="empty-state">You haven't started or joined a project yet. Tap New Project to get going.</div>
        )}
        {projects && projects.length > 0 &&
          [
            { title: "Drafts", large: true, items: projects.filter((p) => p.status !== "published") },
            { title: "Published", large: false, items: projects.filter((p) => p.status === "published") },
          ]
            .filter((shelf) => shelf.items.length > 0)
            .map((shelf) => (
              <section key={shelf.title} className="shelf">
                <h3>{shelf.title}</h3>
                <div className="shelf-row">
                  {shelf.items.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      people={people[p.id] ?? []}
                      imageUrl={covers[p.id]}
                      large={shelf.large}
                      isOwner={p.initiatorId === userId}
                      onStatus={(id, status) => setProjects((list) => list && list.map((x) => (x.id === id ? { ...x, status } : x)))}
                    />
                  ))}
                </div>
              </section>
            ))}
      </main>
    </AppShell>
  );
}

export function HomePage() {
  return (
    <SignInGate>
      <HomeContent />
    </SignInGate>
  );
}
