// Turns the plain-text hints already written on the buttons ("Play (Space)", "Loop: repeat a highlighted part")
// into the parts the tooltip shows: a name, an optional second line, and an optional keyboard key.

export interface TipParts {
  name: string;
  hint: string | null;
  key: string | null;
}

const KEY_WORDS = /^(Space|Enter|Esc|Delete|Backspace|Tab|Ctrl|Cmd|Shift|Alt|⌘|⇧|⌥|⌃|←|→|↑|↓)/;

function looksLikeKey(inner: string): boolean {
  if (inner.length > 14 || !/^[A-Za-z0-9⌘⇧⌥⌃+/ ←→↑↓]+$/.test(inner)) return false;
  return inner.length <= 2 || KEY_WORDS.test(inner) || inner.includes("+");
}

export function parseTip(text: string): TipParts {
  let rest = text.trim().replace(/\s+/g, " ");
  let key: string | null = null;
  const keyMatch = /\s\(([^()]+)\)$/.exec(rest);
  if (keyMatch && looksLikeKey(keyMatch[1])) {
    key = keyMatch[1];
    rest = rest.slice(0, keyMatch.index);
  }
  const dash = rest.indexOf(" — ");
  if (dash > 0) return { name: rest.slice(0, dash), hint: rest.slice(dash + 3) || null, key };
  const colon = rest.indexOf(": ");
  if (colon > 0 && colon <= 28) return { name: rest.slice(0, colon), hint: rest.slice(colon + 2) || null, key };
  return { name: rest, hint: null, key };
}
