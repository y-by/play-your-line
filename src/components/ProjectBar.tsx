import { useState } from "react";
import { Link } from "react-router-dom";
import { useProjectStore } from "../store/useProjectStore";
import { PresenceDots } from "./PresenceDots";
import { BackArrowIcon } from "./icons/Icons";

/** Left of the control bar: back to the list, and the project's name (the Owner can click it to rename). */
export function ProjectName() {
  const title = useProjectStore((s) => s.project?.title ?? "");
  const isOwner = useProjectStore((s) => s.isInitiator());
  const renameProject = useProjectStore((s) => s.renameProject);
  const [editing, setEditing] = useState(false);
  return (
    <div className="cb-name">
      <Link to="/" className="lg lb cb-back" title="Back to your projects" aria-label="Back to your projects">
        <BackArrowIcon size={16} />
      </Link>
      {isOwner && editing ? (
        <input
          autoFocus
          className="cb-title-input"
          defaultValue={title}
          maxLength={80}
          onBlur={(e) => {
            renameProject(e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Project name"
        />
      ) : (
        <button className={isOwner ? "cb-title" : "cb-title readonly"} onClick={() => isOwner && setEditing(true)} title={isOwner ? `${title} — click to rename` : title}>
          {title}
        </button>
      )}
    </div>
  );
}

/** Right of the control bar: draft or published, whether live updates are on, who is here, and your role. */
export function ProjectStatus() {
  const status = useProjectStore((s) => s.project?.status);
  const realtimeStatus = useProjectStore((s) => s.realtimeStatus);
  const roleLabel = useProjectStore((s) => s.roleLabel());
  return (
    <div className="cb-status">
      <span className="cb-state">{status === "published" ? "Published" : "Draft"}</span>
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
        <span className="live-label">{realtimeStatus === "live" ? "Live" : realtimeStatus === "connecting" ? "Connecting" : "Offline"}</span>
      </span>
      <PresenceDots />
      {roleLabel && (
        <span className="role-badge" title={`Your role in this project: ${roleLabel}`}>
          {roleLabel}
        </span>
      )}
    </div>
  );
}
