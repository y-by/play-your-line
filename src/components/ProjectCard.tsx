import { Link } from "react-router-dom";
import type { Project } from "../types/project";
import { ProjectCover } from "./ProjectCover";
import { coverTint } from "../lib/coverArt";
import { ProjectCardActions } from "./ProjectCardActions";

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
  onStatus,
}: {
  project: Project;
  people: string[];
  imageUrl?: string | null;
  large?: boolean;
  isOwner: boolean;
  onStatus: (id: string, status: "draft" | "published") => void;
}) {
  const style = { "--tint": coverTint(project.id) } as React.CSSProperties;
  return (
    <Link to={`/song/${project.id}`} className={large ? "card card-large" : "card"} style={style}>
      <div className="card-art">
        <ProjectCover id={project.id} imageUrl={imageUrl} />
        <ProjectCardActions project={project} isOwner={isOwner} onStatus={onStatus} />
      </div>
      <div className={large && imageUrl ? "card-body card-body-image" : "card-body"}>
        {large && imageUrl && <img className="card-body-bg" src={imageUrl} alt="" loading="lazy" draggable={false} />}
        <span className="card-title">{project.title}</span>
        <span className="card-people">{people.length ? people.join(" · ") : " "}</span>
      </div>
    </Link>
  );
}
