// ONE SOURCE OF TRUTH for who may do what (Owner, Mixer, Player, Listener).
//
// Every rule is a row here. The screen's checks (the `can...` functions in the store) read from this table, the
// README roles table and docs/RULES.md are WRITTEN from it (`npm run docs:rules`), and a test fails if either file is
// out of date. The database cannot be read by a test, so every row also names what enforces it there (a policy, a
// trigger or a function in a migration); when you change a rule, change the row, run `npm run docs:rules`, and write
// the migration it points to.

import type { Role } from "./roles.ts";

/**
 * Whether a role may do something. `true` always, `false` never, or true only under a condition:
 *   own              the channel is the person's own (the channel assigned to them)
 *   own-or-unassigned  their own channel, or a channel nobody plays yet
 *   author           the thing (a note) was written by them
 */
export type Cell = boolean | { if: "own" | "own-or-unassigned" | "author"; text: string };

export interface Rule {
  id: string;
  /** What the rule is about, in plain words (the row label in the tables). */
  what: string;
  owner: Cell;
  mixer: Cell;
  player: Cell;
  listener: Cell;
  /** What enforces it in the database (a migration), or "screen only" when the database has nothing to check. */
  enforcedBy: string;
  note?: string;
}

export const ROLE_ORDER: Role[] = ["owner", "mixer", "player", "listener"];
export const ROLE_TITLES: Record<Role, string> = { owner: "Owner", mixer: "Mixer", player: "Player", listener: "Listener" };
export const ROLE_WHO: Record<Role, string> = {
  owner: "Created the project",
  mixer: "One person the Owner picks",
  player: "Whoever is on a channel (or was added as a player)",
  listener: "Invited to hear the draft",
};

const own = (text: string): Cell => ({ if: "own", text });

export const RULES: Rule[] = [
  { id: "listen", what: "Listen to the draft", owner: true, mixer: true, player: true, listener: true, enforcedBy: "policies: participants read the song (0001, 0014)" },
  { id: "add-channel", what: "Add a channel", owner: true, mixer: true, player: true, listener: false, enforcedBy: "policy: contributors add a channel (0040, 0042)", note: "A person added by the Owner as a player counts as a Player even before they have a channel." },
  {
    id: "rename-channel",
    what: "Rename a channel",
    owner: true,
    mixer: true,
    player: { if: "own-or-unassigned", text: "their own channel (and any channel nobody plays yet)" },
    listener: false,
    enforcedBy: "trigger guard_track_columns (0040)",
  },
  { id: "assign-player", what: "Put someone on a channel (link, email or pick from the list), reassign it", owner: true, mixer: false, player: false, listener: false, enforcedBy: "functions assign_track_to_user, reassign_track, claim_own_track, accept_track_invite (0009, 0019, 0026)", note: "A channel with recordings can never be reassigned." },
  { id: "channel-order-colour", what: "Channel order and colours, rename or delete a channel", owner: true, mixer: false, player: false, listener: false, enforcedBy: "trigger guard_track_columns; only an empty channel can be deleted (0011, 0040)", note: "Everyone else can arrange the channels for themselves; that stays on their own device." },
  { id: "project-settings", what: "Tempo, time signature, rename or delete the project, cover image, publish", owner: true, mixer: false, player: false, listener: false, enforcedBy: "policies: only the initiator updates or deletes the project (0001); tempo lock (0009, 0039)" },
  { id: "final-mix", what: "Final mix (volume, mute and pan per channel)", owner: true, mixer: true, player: false, listener: false, enforcedBy: "trigger guard_track_columns (0030, 0040)", note: "Players and Listeners can still make their own monitor mix; it is saved only on their device." },
  { id: "master", what: "Master channel (fader, EQ, compressor, limiter)", owner: true, mixer: true, player: false, listener: false, enforcedBy: "function set_master_mix (0043)", note: "Only the Owner and the Mixer see the master. Everyone hears it. The master mute is personal and never saved." },
  { id: "group-structure", what: "Group channels: create, rename, delete, put channels in them", owner: true, mixer: false, player: false, listener: false, enforcedBy: "functions create_track_group, rename_track_group, delete_track_group, set_track_group; trigger guard_track_columns (0044)" },
  { id: "group-mix", what: "Group channels: volume, mute, pan, Tools (effects)", owner: true, mixer: true, player: false, listener: false, enforcedBy: "function set_group_mix (0044)", note: "Everyone hears the saved group settings, and anyone can fold a group or solo it for themselves." },
  {
    id: "channel-fx",
    what: "Channel Tools (EQ, Compressor, Delay, Reverb, Tuner)",
    owner: true,
    mixer: true,
    player: own("their own channel, until the Owner or Mixer locks it"),
    listener: false,
    enforcedBy: "trigger guard_track_columns (0018, 0034, 0040)",
  },
  { id: "fx-lock", what: "Lock or unlock a player's channel effects", owner: true, mixer: true, player: false, listener: false, enforcedBy: "trigger guard_track_columns (0034)" },
  {
    id: "record-edit-clips",
    what: "Record and edit clips",
    owner: own("their own channel"),
    mixer: own("their own channel"),
    player: own("their own channel"),
    listener: false,
    enforcedBy: "policies on clips, takes and storage: only the channel's own player (0009)",
    note: "Nobody touches a player's recordings but that player. The Owner cannot record on or edit someone else's channel.",
  },
  { id: "people", what: "Invite a Mixer or Listeners, add someone by email, choose the Mixer", owner: true, mixer: false, player: false, listener: false, enforcedBy: "functions set_mixer, add_project_member; policies on project_invites (0014, 0031)" },
  { id: "write-notes", what: "Write notes, tag people with @", owner: true, mixer: true, player: true, listener: false, enforcedBy: "function can_write_notes and note policies (0032)", note: "A Player needs a channel to write notes. Listeners only read the notes shared with them." },
  {
    id: "note-edit-done",
    what: "Edit a note, mark it done or reopen it",
    owner: true,
    mixer: { if: "author", text: "their own notes" },
    player: { if: "author", text: "their own notes" },
    listener: false,
    enforcedBy: "trigger guard_project_notes (0033, 0041)",
  },
];

/** Who is asking: the roles they hold, and the facts the conditions in the table look at. */
export interface Who {
  roles: Role[];
  /** The channel in question is assigned to this person. */
  ownChannel?: boolean;
  /** The channel in question has no player. */
  unassigned?: boolean;
  /** The note in question was written by this person. */
  author?: boolean;
}

function cellAllows(cell: Cell, who: Who): boolean {
  if (typeof cell === "boolean") return cell;
  if (cell.if === "own") return !!who.ownChannel;
  if (cell.if === "own-or-unassigned") return !!who.ownChannel || !!who.unassigned;
  return !!who.author;
}

/** May this person do this? Holding any one role that allows it is enough. */
export function can(ruleId: string, who: Who): boolean {
  const rule = RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Unknown rule: ${ruleId}`);
  return who.roles.some((role) => cellAllows(rule[role], who));
}

// ---- The tables written from the rules ---------------------------------------------------------------------------

function cellText(cell: Cell): string {
  if (cell === true) return "✅";
  if (cell === false) return "–";
  return cell.text;
}

/** The roles table that sits in the README. */
export function readmeTable(): string {
  const head = `| | ${ROLE_ORDER.map((r) => ROLE_TITLES[r]).join(" | ")} |`;
  const line = `| --- | ${ROLE_ORDER.map(() => ":---:").join(" | ")} |`;
  const who = `| Who | ${ROLE_ORDER.map((r) => ROLE_WHO[r]).join(" | ")} |`;
  const rows = RULES.map((rule) => `| ${rule.what} | ${ROLE_ORDER.map((r) => cellText(rule[r])).join(" | ")} |`);
  return [head, line, who, ...rows].join("\n");
}

export const README_MARK_START = "<!-- rules-table:start (written by npm run docs:rules from src/lib/rules.ts, do not edit by hand) -->";
export const README_MARK_END = "<!-- rules-table:end -->";

/** docs/RULES.md: the table, plus what enforces each rule in the database. */
export function rulesMarkdown(): string {
  const lines = [
    "# Who may do what",
    "",
    "Written by `npm run docs:rules` from `src/lib/rules.ts`, which is the one source of truth for these rules. Do not edit",
    "this file by hand: change the rule in `src/lib/rules.ts`, run the command, and write the database change the rule points to.",
    "A test fails if this file is out of date.",
    "",
    readmeTable(),
    "",
    "## What enforces each rule in the database",
    "",
    "The screen hides what you cannot do, but the database is what really stops it.",
    "",
    "| Rule | Enforced by | Note |",
    "| --- | --- | --- |",
    ...RULES.map((r) => `| ${r.what} | ${r.enforcedBy} | ${r.note ?? ""} |`),
    "",
    "See also `docs/SECURITY.md` for who can call each database function.",
    "",
  ];
  return lines.join("\n");
}
