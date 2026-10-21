import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { SignInGate } from "../components/SignInGate";
import { AppShell } from "../components/AppShell";
import { ProjectCard } from "../components/ProjectCard";
import { listMyProjects, fetchParticipantNames, fetchCoverUrls, fetchMyRoleLabels, fetchProjectNews, saveMyProjectOrder, type ProjectNews } from "../lib/projectApi";
import type { Project } from "../types/project";

function HomeContent() {
  const userId = useAuthStore((s) => s.userId);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<Record<string, string[]>>({});
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [news, setNews] = useState<Record<string, ProjectNews>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listMyProjects(userId)
      .then((list) => {
        setProjects(list);
        fetchCoverUrls(list).then(setCovers).catch((err) => console.error("Failed to load covers:", err));
        fetchMyRoleLabels(userId, list).then(setRoles).catch((err) => console.error("Failed to load your roles:", err));
        fetchParticipantNames(list).then(setPeople).catch((err) => console.error("Failed to load participant names:", err));
      })
      .catch((err) => {
        console.error("Failed to load your projects:", err);
        const detail = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
        setLoadError(`Couldn't load your projects${detail ? ` (${detail})` : ""}. If you just updated the app, the latest database step may not have been run yet.`);
      });
  }, [userId]);

  // The news on the cards: loaded now, and again whenever the tab comes back.
  useEffect(() => {
    if (!userId) return;
    const load = () => {
      if (document.visibilityState === "visible") fetchProjectNews(userId).then(setNews).catch((err) => console.error("Failed to load project news:", err));
    };
    load();
    document.addEventListener("visibilitychange", load);
    return () => document.removeEventListener("visibilitychange", load);
  }, [userId]);

  // Drop a card on another card in the same row: it takes that place, in this person's own list.
  const dropOn = (targetId: string) => {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (!from || from === targetId || !projects || !userId) return;
    const status = (id: string) => projects.find((p) => p.id === id)?.status === "published";
    if (status(from) !== status(targetId)) return;
    const row = projects.filter((p) => status(p.id) === status(from));
    const ids = row.map((p) => p.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(targetId) + (row.findIndex((p) => p.id === from) < row.findIndex((p) => p.id === targetId) ? 1 : 0), 0, from);
    const before = projects;
    const place = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
    setProjects(projects.map((p) => (place.has(p.id) ? { ...p, sortOrder: place.get(p.id)! } : p)).sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || b.updatedAt - a.updatedAt));
    setOrderError(null);
    saveMyProjectOrder(userId, ids).catch((err) => {
      console.error("Failed to save the project order:", err);
      setOrderError("Couldn't save the new order. If you just updated the app, the latest database step (0054) may not have been run yet.");
      setProjects(before);
    });
  };

  return (
    <AppShell title="Projects">
      <main className="home-shelves">
        {projects === null && !loadError && <div className="empty-state">Loading your projects…</div>}
        {orderError && <div className="empty-state">{orderError}</div>}
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
                      drag={{ dragging: dragId === p.id, over: overId === p.id && dragId !== p.id, onStart: () => setDragId(p.id), onOver: () => setOverId(p.id), onDrop: () => dropOn(p.id), onEnd: () => { setDragId(null); setOverId(null); } }}
                      roleLabel={roles[p.id] ?? null}
                      news={news[p.id] ?? null}
                      isOwner={p.initiatorId === userId}
                      onLeft={(id) => setProjects((list) => list && list.filter((x) => x.id !== id))}
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
