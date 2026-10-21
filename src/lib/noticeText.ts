import type { UserNotice } from "./projectApi";

interface NoticeCopy {
  icon: string;
  heading: string;
  /** The popup's text. */
  text: string;
  /** One short line for the project card. */
  short: string;
}

/** The words for each kind of notice: the popup's heading and text, and the short line for a project card. */
export function noticeCopy(n: UserNotice, who: string, title: string, channel: string): NoticeCopy {
  const item = n.item ?? "a channel";
  switch (n.kind) {
    case "project_handed_over":
      return {
        icon: "★",
        heading: "You're the new Owner",
        text: `${who} handed ${title} over to you. You now set the tempo, invite people, choose the Mixer, publish, and look after everything in it.`,
        short: `${who} made you the Owner`,
      };
    case "member_left": {
      const kept = n.detail === 1 ? "Their channel with recordings is" : `Their ${n.detail} channels with recordings are`;
      return {
        icon: "👋",
        heading: `${who} left your project`,
        text: `${who} left ${title}.${n.detail > 0 ? ` ${kept} now yours, so the music is still there.` : " Their empty channels are free for someone else."}`,
        short: `${who} left`,
      };
    }
    case "added_to_project":
      return { icon: "🎶", heading: "You've been added to a project", text: `${who} added you to ${title}. You can listen, and add and play your own channel.`, short: `${who} added you` };
    case "channel_assigned":
      return { icon: "🎙️", heading: "You have a channel", text: `${who} put you on ${channel} in ${title}. It's yours to record and edit.`, short: `${who} put you on ${item}` };
    case "channel_removed":
      return { icon: "🎚️", heading: "You're off a channel", text: `${who} took you off ${channel} in ${title}. Anything you recorded there stays in the project.`, short: `${who} took you off ${item}` };
    case "mixer_assigned":
      return {
        icon: "🎛️",
        heading: "You're the Mixer",
        text: `${who} made you the Mixer of ${title}. You set the final mix: levels, mute, pan and effects of every channel. You can't touch anyone's recordings.`,
        short: `${who} made you the Mixer`,
      };
    case "note_tagged":
      return {
        icon: "💬",
        heading: `${who} tagged you in a note`,
        text: `${who} tagged you in a note in ${title}${n.item ? `: "${n.item}"` : "."}`,
        short: `${who} tagged you in a note`,
      };
    case "mixer_removed":
      return { icon: "🎛️", heading: "You're no longer the Mixer", text: `${who} chose someone else as the Mixer of ${title}. You're still in the project.`, short: "You're no longer the Mixer" };
  }
}
