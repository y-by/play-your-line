// The questions and answers shown on the Help page, and in the small "?" pop-ups next to the tools.
// Plain text only (paragraphs); keep each answer short and say what the app really does.

export interface HelpTopic {
  id: string;
  group: string;
  question: string;
  /** One string per paragraph. */
  answer: string[];
  /** Pictures shown after a paragraph (index into `answer`); files live in public/help. Only the Help page shows them. */
  figures?: { after: number; src: string; alt: string; caption: string }[];
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
    id: "leave-project",
    group: "Getting started",
    question: "How do I leave a project?",
    answer: [
      "Anyone who is not the Owner can leave: open the project, then Settings > General > Leave this project. On the Projects list there is also a small cross on the project's card.",
      "Nothing you recorded is deleted. A channel of yours with no recordings becomes free for someone else; a channel with recordings stays in the project with the Owner, who can keep or delete it. If you were the Mixer, the Owner can pick a new one.",
      "The Owner can't just leave. In Settings > General pick who takes over, and the project is handed to them. If nobody else is in the project, delete it instead (Settings > Project).",
      "Once you have left, you can only come back if the Owner invites you again.",
    ],
  },
  {
    id: "stereo-channel",
    group: "Recording",
    question: "What is a stereo channel, and how do I record one?",
    answer: [
      "When you add a channel you can choose Mono or Stereo. A mono channel records one input. A stereo channel records two inputs, left and right, as one stereo take: good for a keyboard or synth with a left and a right output, or a pair of microphones.",
      "With an audio interface, a stereo channel records inputs 1 and 2 as left and right. To use other inputs (say 3 and 4), press Input on the channel and pick the pair. With a device that has only one input, both sides get the same signal.",
      "A stereo channel shows a small ST next to its name. You can't switch a channel between mono and stereo once it has recordings, so choose when you add it. Stereo audio files you drop onto any channel are kept in stereo.",
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
    id: "join-clips",
    group: "Editing clips",
    question: "How do I join several clips into one?",
    answer: [
      "Drag across empty space in a channel to draw a rectangle: every clip of that channel it touches is selected (hold Shift or ⌘/Ctrl to add to what is selected). You can also click a clip and Shift-click (or ⌘/Ctrl-click) more of the same channel. ⌘/Ctrl-A selects every clip of the channel. Then press the Join button in the editing bar, or J (⌘/Ctrl-J works too).",
      "Pieces of one recording that sit side by side, like a clip you split and did not move, simply become one clip again. Otherwise (after a quantise moved the pieces, or the clips come from different recordings) what you hear of them, with fades and overlaps, is made into one new recording that replaces them; gaps become silence. Undo brings the separate clips back.",
      "Delete removes every selected clip. Moving, trimming and fading still work on one clip at a time.",
    ],
  },
  {
    id: "record-other-app",
    group: "Recording",
    question: "How do I record the sound of my DAW or a synth (another app) into a channel?",
    answer: [
      "A browser cannot load plugins, but it can record any sound your computer can play. The trick is a free virtual cable: your DAW (Logic, Ableton, Reaper, Cubase, GarageBand) plays into the cable, and Play Your Line records from the cable as if it were a microphone. Your MIDI keyboard and your plugins stay in the DAW.",
      "Mac, one time: install BlackHole 2ch (free, existential.audio, or `brew install blackhole-2ch`). Open Audio MIDI Setup (Spotlight), press + at the bottom left and choose Create Multi-Output Device. Tick your headphones or speakers first, then tick BlackHole 2ch and switch Drift Correction on for BlackHole only. Give everything the same sample rate, for example 48 kHz.",
      "Mac, every time: in your DAW, set the audio output to that Multi-Output Device (you hear the DAW and the cable gets it). In Play Your Line open Settings > Audio and set Input to BlackHole 2ch and Output to your headphones, not to the Multi-Output Device. Arm your channel and record: the DAW's sound is recorded as one channel.",
      "Windows: install VB-Audio Virtual Cable (free). In your DAW choose CABLE Input as the output. In Play Your Line set Input to CABLE Output and Output to your headphones. To hear the DAW as well: Sound settings > More sound settings > Recording > double-click CABLE Output > Listen > tick Listen to this device and pick your headphones.",
      "Good to know. Today a channel records one input (mono): a stereo sound from the DAW is recorded as one channel (stereo takes are planned). Never send Play Your Line's own output into the cable, or the song records itself. If the recording sits a little early or late, set the delay in Settings > Audio > Timing, or nudge the clip. Use Chrome or Edge. If you see a message about two sample rates, set the DAW, the cable and your output to the same rate (48 kHz is a good choice).",
      "Already have a part from the DAW? Skip all of this: export it as a WAV from the start of the song and drop it on your channel (several files at once make one channel each).",
    ],
    figures: [
      { after: 0, src: "/help/record-route.svg", alt: "Your DAW plays into a virtual cable and also to your headphones; Play Your Line records from the cable", caption: "The route: the DAW's sound goes through the cable into Play Your Line." },
      { after: 1, src: "/help/shot-mac-multi-output.png", alt: "Audio MIDI Setup: a Multi-Output Device with the interface and BlackHole 2ch ticked, Drift Correction on for BlackHole", caption: "Mac: Audio MIDI Setup, the Multi-Output Device (your device names will differ)." },
      { after: 2, src: "/help/record-settings.svg", alt: "Play Your Line settings: input BlackHole, output headphones", caption: "In Play Your Line: input = the cable, output = your headphones." },
      { after: 3, src: "/help/record-windows.svg", alt: "Windows: VB-Cable and Listen to this device", caption: "Windows: VB-Cable and Listen to this device (illustration)." },
    ],
  },
  {
    id: "move-clip",
    group: "Recording",
    question: "How do I move a clip to another channel?",
    answer: [
      "Drag the clip up or down onto another channel of yours: the channel it can go to lights up, and the clip moves when you let go. A channel is yours when you are its player. You can have several (for example one for takes and one for doubles).",
      "The Owner can do the same for any player: drag a clip onto another channel of that same player. Nobody can move a clip to another player's channel, and the Owner cannot change a player's clip in any other way.",
      "The moved clip keeps its fades and its place in the song, and a short extra bit of the recording on each side so you can still trim it a little. Moving is not an undo step: drag the clip back to take it back.",
    ],
  },
  {
    id: "loop-tempo",
    group: "Recording",
    question: "What happens when I drop a loop that is at another tempo?",
    answer: [
      "Drop an audio file on your channel. If it looks like a loop (its name says something like 96bpm, or its beats are clear) and its tempo is not the song's, a small window asks what to do: Fit it to the song's tempo, keep it as it is, or (the Owner, before anything is recorded) set the song to the loop's tempo.",
      "Fit to the song stretches the sound without changing the pitch, which suits sustained sounds but softens drum hits. For drums choose Fit, keep the hits' sound: the loop is cut at each hit and the hits are moved into place, so every hit keeps its exact sound (long rings are cut short when the tempo goes faster). Either way the result is added as a new recording on your channel. The window shows the tempo it found; if it is wrong, type the right one before you fit. A recording that is not a loop (a voice, a pad, a whole song) is added as it is, with no question.",
      "If you know a file's tempo (drums or stems from another project, for example), switch on Settings > General > Ask for the tempo of every file. Then every file you drop asks for its tempo, you type it (or read it from the file name), and Fit to the song makes it line up. Files dropped together are asked one after the other.",
    ],
  },
  {
    id: "fx",
    group: "Mixing and effects",
    question: "How do the effects switches work?",
    answer: [
      "Each channel has a power switch at the top right of its Tools box. It starts off, and opening the Tools box turns it on for you (if you may change it). With the power off a channel is heard dry, whatever the knobs say; your settings are kept.",
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
      "The master fader goes from silence up to +6 dB, like a channel fader (the limiter is the safety net when you push it). Master mute silences the whole song for you only: it is never saved, nobody else hears the difference and an export is never silent because of it.",
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
