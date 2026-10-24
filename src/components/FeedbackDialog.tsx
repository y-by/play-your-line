import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useFeedbackStore } from "../store/useFeedbackStore";
import { sendFeedback } from "../lib/feedback";
import { deviceSummary, feedbackProblem, pageInfo, FEEDBACK_MAX } from "../lib/feedbackInfo";
import { errorMessage } from "../lib/errorMessage";

/** "Send feedback": a message, an optional screenshot (pick a file or paste one), sent to the system owner's Admin page. Mounted once in App. */
export function FeedbackDialog() {
  const open = useFeedbackStore((s) => s.open);
  const draft = useFeedbackStore((s) => s.draft);
  const setDraft = useFeedbackStore((s) => s.setDraft);
  const close = useFeedbackStore((s) => s.close);
  const userId = useAuthStore((s) => s.userId);
  const { pathname } = useLocation();
  const [shot, setShot] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pictureFailed: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const page = useMemo(() => pageInfo(pathname), [pathname]);

  const shotUrl = useMemo(() => (shot ? URL.createObjectURL(shot) : null), [shot]);
  useEffect(() => {
    return () => {
      if (shotUrl) URL.revokeObjectURL(shotUrl);
    };
  }, [shotUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const reset = () => {
    setShot(null);
    setError(null);
    setDone(null);
  };
  const closeAndReset = () => {
    close();
    if (done) reset();
  };

  const pickImage = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file is not a picture. Pick a screenshot (PNG or JPEG).");
      return;
    }
    setError(null);
    setShot(file);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      pickImage(file);
    }
  };

  const problem = feedbackProblem(draft);
  const send = async () => {
    if (sending) return;
    if (!userId) {
      setError("Sign in first, then send your feedback.");
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await sendFeedback({
        userId,
        message: draft,
        screenshot: shot,
        projectId: page.projectId,
        page: page.page,
        appBuild: typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "local",
        device: deviceSummary({
          ua: navigator.userAgent,
          screenW: window.screen.width,
          screenH: window.screen.height,
          windowW: window.innerWidth,
          windowH: window.innerHeight,
          pixelRatio: window.devicePixelRatio,
          language: navigator.language,
        }),
      });
      setDraft("");
      setShot(null);
      setDone(result);
    } catch (err) {
      console.error("Feedback was not sent:", err);
      setError(errorMessage(err, "Couldn't send that. Check your connection and try again; your text is kept."));
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="zip-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAndReset(); }}>
      <div className="zip-panel fb-panel" role="dialog" aria-label="Send feedback" onPaste={onPaste}>
        {done ? (
          <>
            <h3>Thank you</h3>
            <p className="zip-lead">Your feedback was sent. It goes straight to the person who runs Play Your Line.</p>
            {done.pictureFailed && <p className="fb-warn">The screenshot could not be sent, but your message did.</p>}
            <button className="fb-send" onClick={closeAndReset}>Close</button>
          </>
        ) : (
          <>
            <h3>Send feedback</h3>
            <p className="zip-lead">Something broken, confusing, or missing? Say what happened and what you expected. A screenshot helps a lot.</p>
            <textarea
              id="feedback-message"
              className="fb-text"
              autoFocus
              value={draft}
              maxLength={FEEDBACK_MAX + 200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send(); }}
              placeholder="What happened? What did you expect?"
              aria-label="Your feedback"
            />
            <div className="fb-shot">
              {shotUrl ? (
                <div className="fb-thumb">
                  <img src={shotUrl} alt="Your screenshot" />
                  <button type="button" onClick={() => setShot(null)} aria-label="Remove the screenshot">Remove</button>
                </div>
              ) : (
                <button type="button" className="fb-attach" onClick={() => fileInput.current?.click()}>Add a screenshot</button>
              )}
              <input ref={fileInput} id="feedback-file" type="file" accept="image/*" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />
              {!shotUrl && <span className="zip-size">or paste one here with Cmd+V (Ctrl+V on Windows). On a Mac, Cmd+Ctrl+Shift+4 copies a screenshot you can paste.</span>}
            </div>
            <p className="zip-size">Sent with it: this page{page.projectId ? " and the project you are in" : ""}, the app version, and your browser and screen size. Nothing else.</p>
            {error && <p className="fb-warn" role="alert">{error}</p>}
            <div className="fb-row">
              <button className="zip-cancel" onClick={closeAndReset} disabled={sending}>Cancel</button>
              <button className="fb-send" onClick={() => void send()} disabled={sending || !!problem}>{sending ? "Sending…" : "Send"}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
