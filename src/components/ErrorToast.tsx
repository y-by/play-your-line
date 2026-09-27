import { useEffect } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { CloseIcon } from "./icons/Icons";

const AUTO_DISMISS_MS = 8000;

/** Errors appear as a small message at the bottom of the screen, out of the way of the controls and channels. */
export function ErrorToast() {
  const recordingError = useProjectStore((s) => s.recordingError);
  const editError = useProjectStore((s) => s.editError);
  const message = editError ?? recordingError;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => useProjectStore.setState({ editError: null, recordingError: null }), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className="toast" role="alert">
      <span className="toast-text">{message}</span>
      <button
        className="toast-close"
        onClick={() => useProjectStore.setState({ editError: null, recordingError: null })}
        aria-label="Dismiss"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
