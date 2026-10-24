# Pictures and video for the "Set up your sound" guide

The guide (`src/components/SetupGuide.tsx`, words in `src/lib/setupGuide.ts`) works with text only. Each step has an empty
`media` list. To add a picture or a short video:

1. Put the file in `public/help/setup/` (create the folder). Use a descriptive name, for example `mic-allow.png`.
2. In `src/lib/setupGuide.ts`, find the step and add to its `media`:
   `{ kind: "image", src: "/help/setup/mic-allow.png", alt: "The browser asking to allow the microphone" }`
   or `{ kind: "video", src: "/help/setup/level.mp4", alt: "Playing a guitar and watching the bar" }`.
3. Nothing else changes. Pictures show under the step's list; video plays with controls, muted, inline.

Keep private things out of every picture and video (account names, email, private project names, a phone's name). The repo is public.
Keep videos short (under 20 seconds) and small (MP4, under 3 MB), because they download for everyone who opens the guide.

## What each step would like

| Step | Picture | Video |
| --- | --- | --- |
| Start | none needed | none |
| Microphone | the browser's "Allow microphone" bubble; the Input list with an interface chosen; the small lock next to the address bar with Microphone set to Allow | none |
| Level | the level bar in the green, in the yellow, and in the red (three small pictures) | 10 seconds: playing, the bar moving, the message changing from "A little quiet" to "Good level" |
| Headphones | the Output list; wired headphones next to the "Bluetooth adds delay" line | none |
| Test | the Record button, the little player, and the four answers | 10 seconds: record, play back, press "Yes, it sounds clean" |
| Fix: sample rate, Mac | Audio MIDI Setup with the Format menu showing the same Hz for the microphone and the headphones | 15 seconds: opening Audio MIDI Setup and changing Format |
| Fix: sample rate, Windows | Sound settings, then More sound settings, then Advanced, with Default Format and "exclusive control" | 15 seconds |

The two sample-rate fixes sit in `rateAdvice` (a list of steps for Mac and for Windows), not in `SETUP_STEPS`. When their pictures
exist, add a `media` field to that function's result and show it in the "Clicks, crackle or noise" block of `SetupGuide.tsx`.
