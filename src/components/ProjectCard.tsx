import { Link } from "react-router-dom";
import type { Project } from "../types/project";
import { ProjectCover } from "./ProjectCover";
import { coverTint } from "../lib/coverArt";
import { ProjectCardActions } from "./ProjectCardActions";
import { useAuthStore } from "../store/useAuthStore";
import { clearProjectNews, type ProjectNews } from "../lib/projectApi";
import { noticeCopy } from "../lib/noticeText";

/**
 * Large cards (the drafts): a square cover on top, and the cover's colour carries on underneath (a
 * darker tint of it, or a blurred copy of the uploaded image under dark glass) holding the centred
 * title and people. Small cards: just the square cover, with the text left-aligned on the page.
 */
export function ProjectCard({
  project,
  people,
  imageUrl,
  large,
  isOwner,
  roleLabel,
  news,
  onStatus,
  onLeft,
  drag,
}: {
  project: Project;
  people: string[];
  imageUrl?: string | null;
  large?: boolean;
  isOwner: boolean;
  /** What the signed-in person is in this project (Owner, Mixer, Player, Listener). */
  roleLabel?: string | null;
  /** The latest news about this person in this project; highlighted until they open the project. */
  news?: ProjectNews | null;
  onStatus: (id: string, status: "draft" | "published") => void;
  onLeft?: (id: string) => void;
  /** The card can be dragged to a new place in its row (the person's own list). */
  drag?: { dragging: boolean; over: boolean; onStart: () => void; onOver: () => void; onDrop: () => void; onEnd: () => void };
}) {
  const userId = useAuthStore((s) => s.userId);
  const unread = !!news?.unread;
  const newsLine = news ? noticeCopy(news.notice, news.notice.fromName ?? "Someone", "", "").short : null;
  const style = { "--tint": coverTint(project.id) } as React.CSSProperties;
  return (
    <Link
      to={`/song/${project.id}`}
      className={`${large ? "card card-large" : "card"}${unread ? " has-news" : ""}${drag?.dragging ? " dragging" : ""}${drag?.over ? " drop-here" : ""}`}
      draggable={!!drag}
      onDragStart={drag ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", project.id); drag.onStart(); } : undefined}
      onDragOver={drag ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; drag.onOver(); } : undefined}
      onDrop={drag ? (e) => { e.preventDefault(); drag.onDrop(); } : undefined}
      onDragEnd={drag ? drag.onEnd : undefined}
      style={style}
      onClick={() => {
        if (unread && userId) clearProjectNews(userId, project.id).catch(() => {});
      }}
    >
      <div className="card-art">
        <ProjectCover id={project.id} imageUrl={imageUrl} />
        {roleLabel && <span className={`card-role${roleLabel === "Owner" ? " owner" : ""}`}>{roleLabel}</span>}
        {unread && <span className="card-new" aria-label="New">New</span>}
        <ProjectCardActions project={project} isOwner={isOwner} roleLabel={roleLabel} onStatus={onStatus} onLeft={onLeft} />
      </div>
      <div className={large && imageUrl ? "card-body card-body-image" : "card-body"}>
        {large && imageUrl && <img className="card-body-bg" src={imageUrl} alt="" loading="lazy" draggable={false} />}
        <span className="card-title">{project.title}</span>
        <span className="card-people">{people.length ? people.join(" · ") : " "}</span>
        {newsLine && (
          <span className={unread ? "card-news unread" : "card-news"} title={newsLine}>
            {newsLine}
          </span>
        )}
      </div>
    </Link>
  );
}
