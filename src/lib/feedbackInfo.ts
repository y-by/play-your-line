// What is checked and attached to a feedback report. Pure (no Supabase, no browser), so it is tested with plain values.

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 4000;

/** Why the message cannot be sent yet, or null when it is fine. */
export function feedbackProblem(message: string): string | null {
  const n = message.trim().length;
  if (n < FEEDBACK_MIN) return "Write a few words about what happened or what you would like.";
  if (n > FEEDBACK_MAX) return `That is ${n - FEEDBACK_MAX} characters too long. Keep it under ${FEEDBACK_MAX}.`;
  return null;
}

/** "Chrome 130" / "Safari 17" / "Firefox 131" / "Edge 130", read from the browser's own description. */
export function browserOf(ua: string): string {
  const pick = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? `${name} ${m[1].split(".")[0]}` : null;
  };
  return (
    pick(/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge") ??
    pick(/(?:OPR|Opera)\/([\d.]+)/, "Opera") ??
    pick(/(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox") ??
    pick(/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome") ??
    pick(/Version\/([\d.]+).*Safari/, "Safari") ??
    "an unknown browser"
  );
}

/** "macOS" / "Windows" / "iPhone" / "iPad" / "Android" / "Linux". */
export function systemOf(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "an unknown system";
}

/** One line a person can read and the owner can use: browser, system, screen and window size, language. */
export function deviceSummary(env: { ua: string; screenW: number; screenH: number; windowW: number; windowH: number; pixelRatio: number; language: string }): string {
  const ratio = env.pixelRatio && env.pixelRatio !== 1 ? ` @${Math.round(env.pixelRatio * 10) / 10}x` : "";
  return `${browserOf(env.ua)} on ${systemOf(env.ua)} · screen ${env.screenW}×${env.screenH}${ratio} · window ${env.windowW}×${env.windowH} · ${env.language || "?"}`;
}

/** The page the person was on, without any query or hash: "/song/abc…" becomes the project id and "/song". */
export function pageInfo(pathname: string): { page: string; projectId: string | null } {
  const m = pathname.match(/^\/song\/([0-9a-f-]{36})/i);
  return { page: (m ? "/song" : pathname).slice(0, 300), projectId: m ? m[1].toLowerCase() : null };
}
