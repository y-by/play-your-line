// The questions and answers shown on the Help page, and in the small "?" pop-ups next to the tools.
// Plain text only (paragraphs); keep each answer short and say what the app really does.

export interface HelpTopic {
  id: string;
  group: string;
  question: string;
  /** One string per paragraph. */
  answer: string[];
}

export const HELP_GROUPS = ["Getting started", "Recording", "Editing clips", "Mixing and effects", "Notes", "Publishing and sharing", "If something goes wrong"] as const;

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "start",
    group: "Getting started",
    question: "How do I start a project?",
    answer: [
      "Press New Project in the menu. In the project, use the + button in the control bar to add a channel for each instrument or voice (type the instrument, for example Guitar, and press Add Channel).",
      "To play a channel yourself, press Play it on that channel. To bring someone else in, see \"How do I invite someone?\".",
    ],
  },
  {
    id: "invite",
    group: "Getting started",
    question: "How do I invite someone?",
    answer: [
      "Only the Owner (the person who made the project) invites people. Press the People button in the control bar and either copy an invite link, or type the email of someone who already has an account.",
      "To give a person their own channel, open the + button (Channels): you can send a link for a channel, or assign it to someone who is already in the project. A channel that has recordings can't be reassigned.",
    ],
  },
  {
    id: "roles",
    group: "Getting started",
    question: "What are Owner, Mixer, Player and Listener?",
    answer: [
      "Owner: made the project. Sets the tempo, the order and colours of channels, invites people, and publishes.",
      "Mixer: one person the Owner picks to set the final mix (volume, mute, pan and effects of every channel). The Mixer can't touch anyone's recordings.",
      "Player: the person on a channel. Records and edits only their own channel, and can use effects on it (unless the Owner or Mixer locks it).",
      "Listener: can listen to the draft and read notes that were shared with listeners.",
    ],
  },
  {
    id: "record",
    group: "Recording",
    question: "How do I record?",
    answer: [
      "Press the round dot on your channel to arm it, then press the red record button (or R). A count-in (1, 2 or 3 bars, chosen in Settings; four clicks a bar in 4/4, three in 3/4) plays first if the numbers button is switched on, and the recording lands exactly where you started.",
      "You can also drag an audio file onto your own channel to put it there. A recording is never changed: what you see on a channel are clips, windows onto it.",
    ],
  },
  {
    id: "time-signature",
    group: "Getting started",
    question: "How do I change the time signature, for example to 3/4?",
    answer: [
      "Only the Owner can. In the number display at the top, press the time signature (it says 4/4 at first) and pick another one, such as 3/4. The beats stay exactly where they were; only the way they are grouped into bars changes.",
      "The bar lines, the bar numbers, the click's strong first beat and the count-in all follow it. Notes pinned to a bar keep their place in the song, so their bar number may change.",
    ],
  },
  {
    id: "latency",
    group: "Recording",
    question: "My recording sounds a little late or early. What do I do?",
    answer: [
      "Open Settings (the gear) and find Timing. Press Calibrate and let the app play and hear a click through your speakers and microphone. Headphones don't work for this, because the microphone must hear the click.",
      "It then places every recording where it should be, using the measured delay of your own equipment.",
    ],
  },
  {
    id: "tuner",
    group: "Recording",
    question: "How does the tuner work?",
    answer: [
      "Open a channel's Tools box and press the tuning-fork button at the bottom. The tuner opens in its own window and stays on screen when you close the Tools box; its × closes it.",
      "Play one note. The big letter is the note, and the stripes show how far off you are: they drift left when you're flat, right when you're sharp, and stand still, turning green, when you're in tune. Bass works too, down to a 5-string's low B.",
      "Choose Guitar, Bass or Ukulele and tap a string to tune to that string, or leave it on Any note. The A = 440 reference can be moved with − and +.",
    ],
  },
  {
    id: "chords",
    group: "Recording",
    question: "What does the Chords button do?",
    answer: [
      "It listens to a channel and writes the chords it hears along the top of that channel, one per stretch. Press a chord to move the playhead there. Press Chords again to hide them.",
      "It's a suggestion, not a guarantee: chords it isn't sure about show in italics with a question mark. Your choice is remembered for each channel of a project.",
    ],
  },
  {
    id: "clips",
    group: "Editing clips",
    question: "How do I trim, split, move or copy a clip?",
    answer: [
      "Drag a clip to move it. Drag its left or right edge to trim. Press S to split at the playhead, Ctrl or ⌘ + D to duplicate, Delete to remove. ⌘ or Ctrl + Z undoes (add ⇧ to redo).",
      "Where two clips overlap, the newer one plays and the older one is silent underneath, but it plays again wherever nothing covers it.",
    ],
  },
  {
    id: "quantise",
    group: "Editing clips",
    question: "How do I quantise a drum or bass clip?",
    answer: [
      "Select a clip on a channel of yours and press the Quantise button in the toolbar. Pick the grid (1/8, 1/16 or 1/32), then Strength: 100% puts every hit exactly on the grid, 50% moves each one half way. The hits it found are marked on the clip first, so you can see what it will do.",
      "It works best on drums and picked or plucked bass, where each hit starts sharply. If it misses soft notes, raise Sensitivity; if it marks too many, lower it. Quantise cuts the clip into pieces and moves them; your recording is never changed, and Undo puts it all back.",
    ],
  },
  {
    id: "fades",
    group: "Editing clips",
    question: "How do I fade a clip in or out?",
    answer: [
      "Hover or select a clip and drag the small round handle at its top-left (fade in) or top-right (fade out). The shaded corner shows the ramp. Double-click a handle to remove the fade.",
      "Fades belong to the clip: they're heard in playback and in Export Mix, shared with everyone, and can be undone.",
    ],
  },
  {
    id: "fx",
    group: "Mixing and effects",
    question: "How do the effects switches work?",
    answer: [
      "Each channel has a power switch at the top right of its Tools box. It is off by default: a channel with the power off is heard dry, whatever the knobs say. Your settings are kept.",
      "Each effect (EQ, Comp, Delay, Reverb) also has its own bypass switch next to its name. With the power on, a bypassed effect is skipped and the others still work. An effect set to do nothing is skipped too, so it never colours the sound.",
      "Compare plays the channel dry just for you, to check what the effects add. It's never saved and ends when you close the box.",
    ],
  },
  {
    id: "fx-windows",
    group: "Mixing and effects",
    question: "Can I pull a tab out of the Tools box?",
    answer: [
      "Yes. Drag a tab (EQ, Comp, Delay or Reverb) out of the tab strip and it becomes a window of its own. Close the main box and it stays on screen. Dock puts it back, and Dock all tabs puts every tab back.",
      "Drag the bottom-right corner of any Tools window to make it bigger, up to double. Double-click the corner for normal size.",
    ],
  },
  {
    id: "fx-lock",
    group: "Mixing and effects",
    question: "Who can change a channel's effects?",
    answer: [
      "The Owner and the Mixer always can. The player of a channel can change their own channel's effects too, until the Owner or Mixer presses the lock button in the Tools box. A locked channel shows its effects but can't be changed by its player.",
      "Volume, mute and pan are the saved final mix and are only for the Owner and the Mixer.",
    ],
  },
  {
    id: "groups",
    group: "Mixing and effects",
    question: "What is a group channel?",
    answer: [
      "A group holds several channels, for example Drums holding kick, snare and hats. Its channels play through the group, and the group plays through the master. The group has its own volume, mute, solo, pan and Tools (EQ, Compressor, Delay, Reverb), so you can treat the whole drum kit as one.",
      "Only the Owner makes, renames and deletes groups and puts channels in them (the Groups section of the Add Channel panel). The Owner and the Mixer set a group's volume, mute, pan and effects. Everyone hears the saved group settings, and anyone can fold a group to hide its channels, or solo it for themselves.",
      "Solo beats mute: a soloed channel is heard even when its group is muted, and a soloed group plays all of its channels. Deleting a group keeps its channels, which play straight to the master again.",
      "Groups are part of Export Mix and the MP3 listening copy. If a group changes after a song was published, the refresh button on its card turns amber: update the listening copy.",
    ],
  },
  {
    id: "master",
    group: "Mixing and effects",
    question: "What is the master channel?",
    answer: [
      "The master is the last stop for every channel before the speakers. It sits under the last channel: a fader, a left and right level meter with a clip light, a mute button and a Tools box with EQ, Compressor and a safety Limiter.",
      "The master fader only turns the whole song down. Master mute silences the whole song for you only: it is never saved, nobody else hears the difference and an export is never silent because of it.",
      "Only the Owner and the Mixer see and change the master. It is saved with the project and everyone hears it, players included, so what you hear is what the exported mix sounds like. The master effects start switched off, so older songs sound exactly as before.",
      "The Limiter catches the loudest peaks near -1 dB so the song and the MP3 do not distort. It is a safety net, not a mastering tool. Compare plays the song without the master effects, only for you.",
      "If the master changes after a song was published, the refresh button on its card turns amber: update the listening copy so Published Projects plays the new sound.",
    ],
  },
  {
    id: "monitor",
    group: "Mixing and effects",
    question: "What's the difference between my mix and the final mix?",
    answer: [
      "Players hear either their own monitor mix, which is saved only on their device, or the Owner's saved final mix. Solo is only for you and is never saved.",
      "Export Mix always renders the saved final mix, including each channel's effects, pan and fades.",
    ],
  },
  {
    id: "notes",
    group: "Notes",
    question: "How do notes work?",
    answer: [
      "Press the notes button in the control bar to show notes (they are off by default). Write a note, tag someone by typing @ and picking a name, pin it to any bar, and attach it to a channel if it's about one: it then takes that channel's colour.",
      "Notes show as a tray at the bottom, as floating cards you can pop out (they open on the right, three to a row, with a button to stack them and Open all / Close all in the tray), and as flags on the bar ruler. Marking a note done moves it to the archive. People who only listen see only the notes marked as shared with listeners.",
    ],
  },
  {
    id: "tagged",
    group: "Notes",
    question: "How will I know someone tagged me?",
    answer: [
      "An orange @ badge appears on the notes button with the number of open notes that tag you, even while notes are hidden. If you're in the project when it happens, a message at the top says who tagged you, with an Open button.",
      "The note itself shows a For you label. There's no email or phone alert yet.",
    ],
  },
  {
    id: "publish",
    group: "Publishing and sharing",
    question: "How do I publish or export?",
    answer: [
      "Both are on the project's tile in your Projects list: hover the tile (they're always visible on a touch screen). The globe publishes (the Owner only) or takes a project back to a draft, and the arrow exports the final mix as a WAV file.",
      "A published project appears in the Published list, where everyone who is signed in can listen. Publishing needs at least one recording.",
    ],
  },
  {
    id: "offline",
    group: "If something goes wrong",
    question: "The dot says Offline, or a change couldn't be saved.",
    answer: [
      "Offline means live updates aren't running, so you may not see other people's changes as they happen. Reload the page to reconnect.",
      "If a message says a change couldn't be saved, it was undone to keep your project safe. Try it once more; if it keeps failing, tell the Owner and check your connection.",
    ],
  },
  {
    id: "silent",
    group: "If something goes wrong",
    question: "I can't hear a channel, or the microphone doesn't work.",
    answer: [
      "Check that the channel's M (mute) is off, and that you're not soloing another channel. If you play, check you're listening to the mix you expect: your own monitor mix or the final mix.",
      "For the microphone, allow it when the browser asks, and pick the right input in Settings. If you blocked it earlier, change it in the browser's address-bar site settings and reload.",
    ],
  },
];

export function helpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}
