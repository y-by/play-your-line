import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { fetchUnseenNotices, markNoticeSeen, type UserNotice } from "../lib/projectApi";
import { noticeCopy } from "../lib/noticeText";

const CHECK_MS = 60_000;

/**
 * A card that greets the person with news that happened while they were away: a project handed over to them as the
 * new Owner, or someone leaving a project they own. Checked when they sign in, when the tab comes back, and once a
 * minute; one at a time, each marked seen when closed (0051).
 */
export function NoticePopup() {
  const userId = useAuthStore((s) => s.userId);
  const navigate = useNavigate();
  const [queue, setQueue] = useState<UserNotice[]>([]);

  const check = useCallback(() => {
    if (!userId || document.visibilityState !== "visible") return;
    fetchUnseenNotices(userId)
      .then(setQueue)
      .catch((err) => console.error("Failed to check for notices:", err));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    check();
    const timer = window.setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [userId, check]);

  const notice = queue[0];
  if (!userId || !notice) return null;

  const close = (open: boolean) => {
    setQueue((q) => q.filter((n) => n.id !== notice.id));
    markNoticeSeen(notice.id).catch((err) => console.error("Failed to mark the notice as seen:", err));
    if (open && notice.projectId) navigate(`/song/${notice.projectId}`);
  };

  const who = notice.fromName ?? "Someone";
  const title = notice.projectTitle ? `"${notice.projectTitle}"` : "a project";
  const channel = notice.item ? `the ${notice.item} channel` : "a channel";
  const copy = noticeCopy(notice, who, title, channel);
  // Someone who was taken off a channel or the mixing seat can still open the project (they are not asked to leave it).
  const canOpen = !!notice.projectId && notice.kind !== "channel_removed";

  return (
    <div className="notice-screen" role="alertdialog" aria-labelledby="notice-title">
      <div className="notice-card">
        <div className="notice-badge" aria-hidden="true">{copy.icon}</div>
        <h1 id="notice-title">{copy.heading}</h1>
        <p>{copy.text}</p>
        {queue.length > 1 && <p className="notice-more">{queue.length - 1} more waiting</p>}
        <div className="notice-actions">
          {canOpen && (
            <button className="notice-primary" onClick={() => close(true)}>
              Open project
            </button>
          )}
          <button className="link-btn" onClick={() => close(false)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
