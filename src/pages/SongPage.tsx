import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useProjectStore } from "../store/useProjectStore";
import { Arrangement } from "../components/arrangement/Arrangement";
import { Transport, type SongPanel } from "../components/Transport";
import { NotesTray } from "../components/notes/NotesTray";
import { NoteCards } from "../components/notes/NoteCards";
import { SettingsPanel } from "../components/SettingsPanel";
import { ErrorToast } from "../components/ErrorToast";
import { PresenceDots } from "../components/PresenceDots";
import { mixdownProject } from "../lib/mixdown";
import { WaveformIcon, ExportIcon, BackArrowIcon, GlobeIcon } from "../components/icons/Icons";

export function SongPage() {
  const { id } = useParams<{ id: string }>();
  const project = useProjectStore((s) => s.project);
  const projectLoading = useProjectStore((s) => s.projectLoading);
  const projectError = useProjectStore((s) => s.projectError);
  const loadProject = useProjectStore((s) => s.loadProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const roleLabel = useProjectStore((s) => s.roleLabel());
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const publish = useProjectStore((s) => s.publish);
  const unpublish = useProjectStore((s) => s.unpublish);
  const leaveProject = useProjectStore((s) => s.leaveProject);
  const realtimeStatus = useProjectStore((s) => s.realtimeStatus);
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [panel, setPanel] = useState<SongPanel>(null);

  useEffect(() => {
    if (id) loadProject(id);
  }, [id, loadProject]);

  // Leaving the song stops playback and stops listening for live changes.
  useEffect(() => () => leaveProject(), [leaveProject]);

  const handleExport = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const blob = await mixdownProject(project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/\s+/g, "_")}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm("Publish this project? Everyone signed in will be able to find and listen to it in Published Projects.")) return;
    setPublishing(true);
    try {
      await publish();
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm("Unpublish this project? It will disappear from the Published Projects list and only the people in it will see it.")) return;
    setPublishing(true);
    try {
      await unpublish();
    } finally {
      setPublishing(false);
    }
  };

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

  const hasAnyTake = project.tracks.some((t) => t.clips.length > 0);

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="icon-btn" title="Back to your projects" aria-label="Back to your projects">
          <BackArrowIcon size={16} />
        </Link>
        <h1>
          <span className="header-icon">
            <WaveformIcon size={22} />
          </span>
          {isInitiator && editingTitle ? (
            <input
              autoFocus
              className="title-edit-input"
              defaultValue={project.title}
              onBlur={(e) => {
                renameProject(e.target.value);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button
              className={isInitiator ? "title-edit-trigger" : "title-edit-trigger readonly"}
              onClick={() => isInitiator && setEditingTitle(true)}
              title={isInitiator ? "Rename project" : undefined}
            >
              {project.title}
            </button>
          )}
        </h1>
        <div className="header-meta">
          <span className="project-title">
            {project.status === "published" ? "Published" : "Draft"}
          </span>
          <span
            className={`live-dot ${realtimeStatus}`}
            title={
              realtimeStatus === "live"
                ? "Live — you'll see other people's changes as they happen"
                : realtimeStatus === "connecting"
                  ? "Connecting for live updates…"
                  : "Offline — reload to see the latest changes"
            }
          >
            <span className="dot" />
            {realtimeStatus === "live" ? "Live" : realtimeStatus === "connecting" ? "Connecting" : "Offline"}
          </span>
          <PresenceDots />
          {roleLabel && (
            <span className="role-badge" title={`Your role in this project: ${roleLabel}`}>
              {roleLabel}
            </span>
          )}
        </div>
        {isInitiator && project.status === "draft" && (
          <button className="publish-btn" title="Publish this project" aria-label="Publish" onClick={handlePublish} disabled={!hasAnyTake || publishing}>
            <GlobeIcon size={13} />
            <span className="publish-label">{publishing ? "Publishing…" : "Publish"}</span>
          </button>
        )}
        {isInitiator && project.status === "published" && (
          <button className="publish-btn unpublish" title="Unpublish this project" aria-label="Unpublish" onClick={handleUnpublish} disabled={publishing}>
            <GlobeIcon size={13} />
            <span className="publish-label">{publishing ? "Working…" : "Unpublish"}</span>
          </button>
        )}
        <button className="export-btn" title="Export the mix" aria-label="Export mix" onClick={handleExport} disabled={!hasAnyTake || exporting}>
          <ExportIcon size={14} />
          <span className="export-btn-label">{exporting ? "Mixing…" : "Export Mix"}</span>
        </button>
      </header>

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
      <ErrorToast />
    </div>
  );
}
