import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SignInGate } from "../components/SignInGate";
import { listPublishedProjects, getProject, hydrateTakeBlobs } from "../lib/projectApi";
import { mixdownProject } from "../lib/mixdown";
import type { Project } from "../types/project";
import { WaveformIcon, BackArrowIcon, PlayIcon, PauseIcon, SpinnerIcon } from "../components/icons/Icons";

type PlayState = "idle" | "loading" | "playing" | "paused";

function SongListItem({ project }: { project: Project }) {
  const [state, setState] = useState<PlayState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  const togglePlay = async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("paused");
      return;
    }
    if (audioRef.current) {
      await audioRef.current.play();
      setState("playing");
      return;
    }

    setState("loading");
    try {
      const full = await getProject(project.id);
      await hydrateTakeBlobs(full);
      const blob = await mixdownProject(full);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audio.addEventListener("ended", () => setState("paused"));
      audioRef.current = audio;
      await audio.play();
      setState("playing");
    } catch (err) {
      console.error("Failed to load song for playback:", err);
      setState("idle");
    }
  };

  return (
    <div className="song-list-item">
      <button className="song-play-btn" onClick={togglePlay} disabled={state === "loading"} aria-label="Play">
        {state === "loading" && <SpinnerIcon size={16} />}
        {state !== "loading" && (state === "playing" ? <PauseIcon size={15} /> : <PlayIcon size={15} />)}
      </button>
      <span className="song-list-title">{project.title}</span>
      <Link to={`/song/${project.id}`} className="song-list-open" title="Open in editor">
        Open
      </Link>
    </div>
  );
}

function SongsListContent() {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    listPublishedProjects()
      .then(setProjects)
      .catch((err) => console.error("Failed to load published songs:", err));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="icon-btn" title="Back" aria-label="Back">
          <BackArrowIcon size={16} />
        </Link>
        <h1>
          <span className="header-icon">
            <WaveformIcon size={22} />
          </span>
          Published Songs
        </h1>
      </header>

      <main className="track-list">
        {projects === null && <div className="empty-state">Loading…</div>}
        {projects?.length === 0 && <div className="empty-state">No songs have been published yet.</div>}
        {projects?.map((p) => (
          <SongListItem key={p.id} project={p} />
        ))}
      </main>
    </div>
  );
}

export function SongsListPage() {
  return (
    <SignInGate>
      <SongsListContent />
    </SignInGate>
  );
}
