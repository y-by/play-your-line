import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useProjectStore } from "../store/useProjectStore";
import { Arrangement } from "../components/arrangement/Arrangement";
import { Transport, type SongPanel } from "../components/Transport";
import { NotesTray } from "../components/notes/NotesTray";
import { NoteAlert } from "../components/notes/NoteAlert";
import { NoteCards } from "../components/notes/NoteCards";
import { SettingsPanel } from "../components/SettingsPanel";
import { ErrorToast } from "../components/ErrorToast";

export function SongPage() {
  const { id } = useParams<{ id: string }>();
  const project = useProjectStore((s) => s.project);
  const projectLoading = useProjectStore((s) => s.projectLoading);
  const projectError = useProjectStore((s) => s.projectError);
  const loadProject = useProjectStore((s) => s.loadProject);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const leaveProject = useProjectStore((s) => s.leaveProject);
  const [panel, setPanel] = useState<SongPanel>(null);

  useEffect(() => {
    if (id) loadProject(id);
  }, [id, loadProject]);

  // Leaving the song stops playback and stops listening for live changes.
  useEffect(() => () => leaveProject(), [leaveProject]);

  if (projectLoading) {
    return (
      <div className="app">
        <p className="settings-note">Loading project…</p>
      </div>
    );
  }

  if (projectError || !project) {
    return (
      <div className="app">
        <p className="settings-note">{projectError ?? "This project couldn't be found, or you don't have access to it."}</p>
        <Link to="/" className="link-btn">
          Back to your projects
        </Link>
      </div>
    );
  }

  return (
    <div className="app">
      <Transport panel={panel} onPanel={setPanel} />


      {project.tracks.length === 0 ? (
        <div className="empty-state">
          {isInitiator ? "Use the + button above to add your first channel." : "No channels yet."}
        </div>
      ) : (
        <Arrangement />
      )}

      <SettingsPanel />
      <NotesTray />
      <NoteCards />
      <NoteAlert />
      <ErrorToast />
    </div>
  );
}
