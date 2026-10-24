# PlayYourLine — Competitor Research

Rewritten 2026-10-23. Research only: nothing in the app was changed. Live version with the market-map drawing, comments and edits: https://claude.ai/artifact/31JC39q45gje3UAiHScR6b

## Summary

PYL's real competitors are small band tools, not the big DAWs. **JamUJam** and **Zoundroom** are the closest: band members add their own takes to a shared song, for about €8 a month. Neither is a full DAW, and neither describes roles or per-channel ownership like PYL's.

- **Biggest threat by reach:** [BandLab](https://www.bandlab.com/membership-pricing). Free, web + mobile, up to 50 collaborators per project. It has no part-per-player workflow.
- **Closest in concept:** [JamUJam](https://www.jamujam.com/en) (web, async, comments per track) and [Zoundroom](https://zoundroom.com/en/blog/apps-for-bands-2026-compose-record-organize) (each member's take saved as their own version, up to 8 tracks).
- **Nobody charges for collaborating.** Paid plans sell more tracks or minutes, storage, sounds, AI tools and release services.
- **PYL's position:** the only one that combines a real browser DAW (mixer, master, groups, effects, non-destructive clips) with one owner per part, enforced by the database. It trails on mobile, finding musicians, and storage.

## PYL today

[Play Your Line](https://play-your-line.netlify.app) is live: the Owner starts a song, adds channels, puts one player on each, everyone records only their own part against the mix, and the Owner publishes. Checked against `README.md` and `STATUS.md` (Oct 21).

| Area | What's built |
| --- | --- |
| Roles | Owner, Mixer, Player, Listener; rules enforced by the database; leave / hand over a project |
| Recording | Count-in, latency calibration, mono or stereo channels, per-channel input |
| Editing | Non-destructive clips, trim, split, fades, join, quantise, move a clip between your own channels |
| Mixing | Volume, pan, mute/solo, group busses, master with EQ, compressor, limiter; channel effects and tuner |
| From a DAW | Drop stems (several at once, BWF timestamps place them), tempo fit for loops, guide for recording another app via a virtual cable |
| Team | Notes pinned to bars and channels with @tags, notices, live updates |
| Sharing | Publish, MP3 listening copy, Export Mix |
| Next (decided) | MIDI channels with built-in instruments; no VST/AU in the browser |

Limits today: desktop-first, not installable, no Web MIDI on Safari, Supabase Free plan (1 GB storage, egress over quota in the last cycle).

## Market map

(Drawing in the live doc.) Two axes: together in real time ↔ each on their own time, and solo/producer ↔ band with a part per player.

- **Async band tools (PYL's corner):** Play Your Line (full studio), JamUJam, Zoundroom, Kompoz
- **Live band playing:** JamKazam, SonoBus, Jamulus
- **Real-time studios and DAW bridges:** Soundtrap, Audiotool, SoundBridge, Audiomovers, Muse, LANDR Sessions, Satellite
- **Creator platforms:** BandLab, Suno Studio

PYL's corner holds only light tools (players with comments). The big studios sit elsewhere: real-time co-editing or creator platforms.

## Closest competitors

These share PYL's idea: a band builds a song by each member adding their own part, on their own time. All are lighter than PYL as studios.

| Product | How it works | Platform | Mixing / editing | Roles |
| --- | --- | --- | --- | --- |
| [JamUJam](https://www.jamujam.com/en) | Upload a track, invite the band to record more parts; chat per track; band calendar | Web (mobile site) | Not described | "Track management" only |
| [Zoundroom](https://zoundroom.com/en/blog/apps-for-bands-2026-compose-record-organize) | One project per song; each member's take saved as their own version beside the original; timestamped comments | iOS, Android, web | Multitrack editor, up to 8 tracks; "not a full DAW" (vendor) | Implied by plan (who may edit or comment) |
| [Kompoz](https://www.kompoz.com) | Post an idea, others add parts over weeks by downloading and uploading files | Web | None in the browser; parts made in your own DAW | Owner; paid plans add manager roles and permissions |
| [BandVolt](https://bandvolt.com/) | Band workspace: versions, stems, comments, setlists, calendar, EPK; no in-app recording | Web | None | Contributor, Reviewer, Band Owner |

Zoundroom's details come from its own blog, so treat them as vendor claims. BandVolt is not a recording tool, but its roles and band-workspace features overlap with PYL's notes and project cards.

**BandHub.com is gone.** The original "record your part separately" community (audio and video, founded 2014) shut down on March 15, 2019 ([F6S](https://www.f6s.com/company/bandhub.com), [Spektralfarben](https://www.spektralfarben-music.com/bandhub)). Today's BandHub names are unrelated: [BandHub.co](https://bandhub.co/) and [Band Hub App](https://bandhubapp.com/) do band management and setlists, and [BandHUB by Re.Corder](https://www.recorderinstruments.com/en/bandhub/) is a BLE-MIDI hardware interface. The idea had a real audience but didn't last as a business; worth knowing why before PYL leans on the same model.

## Browser DAWs

These are full studios with sharing built in. They beat PYL on reach and content, but none is built around one player per part.

| Product | Collab model | Platform | Strength | Weak spot for bands |
| --- | --- | --- | --- | --- |
| [BandLab](https://www.bandlab.com/membership-pricing) | Shared, forkable projects, up to 50 collaborators | Web, iOS, Android | Free, huge user base, AI tools, distribution, owns Cakewalk | Social feed first; no per-part ownership described; 16 tracks free |
| [Soundtrap](https://desystemshelp.leeds.ac.uk/podcasting-student/collaborating-in-soundtrap/) | Invite to view, collaborate or comment; live co-editing; timeline comments | Web, iOS | Polished, education market, loops, Auto-Tune | Classroom/beginner image; Spotify-owned |
| [Audiotool](https://www.audiotool.com) | Real-time multiplayer ("Nexus") | Web; VST3, live MIDI | 100% free, no ads, no track caps; new Studio beta Feb 2026 | Built for electronic production, not live instruments |
| Suno Studio | Not stated | Web | AI voice-to-MIDI and stem generation | Generation, not performance |

- **Lesson from BandLab:** don't compete on features or price; compete on the band workflow.
- **Lesson from Soundtrap:** permission levels (view / collaborate / comment) are expected. PYL's four roles go further.
- **Lesson from Audiotool:** browser audio can feel pro, and the live-instrument band space is still open.

## Free vs paid

Almost every tool has a free plan, and collaborating is free in all of them. Paying buys capacity (tracks, minutes, storage), sounds and AI, no ads, and release services.

| Tool | Free plan | Paid plans | What paying adds |
| --- | --- | --- | --- |
| [JamUJam](https://www.jamujam.com/en) | 60 min of audio per jam, own 3 jams, join 6, ads on exports | Premium €7.99/mo or €49.99/yr | 150 min per jam, unlimited own jams and joins |
| [Zoundroom](https://zoundroom.com/en/blog/apps-for-bands-2026-compose-record-organize) | 2 projects, shared with up to 2 people | Pro €7.99/mo; Band €19.99/mo or €149.99/yr | Pro: share with 4. Band: up to 7 people on one subscription |
| [Kompoz](https://www.kompoz.com/pricing) | Starter: start 3 collaborations, join unlimited, MP3 uploads only, keep 70% of store revenue | Plus $5/mo or $49/yr; Premier $10/mo or $99/yr; Pro $20/mo or $199/yr | WAV/AIF/FLAC uploads, manager roles and permissions, track markers, 36–144 own collaborations a year, 80–90% of store revenue |
| [BandVolt](https://bandvolt.com/) | 1 GB, 10 workspace slots | Premium £9.99/mo or £89.99/yr; add-ons £2.49 (+10 slots), £4.99 (+50 GB) | 50 GB, 25 slots, external collaborators with roles |
| [BandLab](https://www.bandlab.com/membership-pricing) | 16 tracks, 3 AI splits a day, ads | Pro $99/yr ($149 from year 2); Max $199/yr ($299 from year 2) | 32 tracks, no ads, unlimited AI splits, more sounds, distribution. Max: Retune, mastering EQ, $50/mo promo credit |
| [Soundtrap](https://www.soundtrap.com/pricing) | Unlimited projects, 7,720+ loops, 450+ instruments, essential effects | 4 plans, $11.99–$19.99/mo, or $9.59–$15.59/mo billed yearly; 7-day trial | Up to 39,620+ loops, 30+ effects, VST/AU support, vocal tuning and cleanup, more mastering styles, podcast transcripts |
| [Audiotool](https://www.audiotool.com) | Everything | None | — |
| [SoundBridge](https://www.soundbridge.io) | Full audio quality, 10 tracks | Monthly, yearly or lifetime (price not listed) | Unlimited tracks, remote recording |
| [JamKazam](https://jamkazam.com) | Live jamming; in 2021: 1-hour sessions, 4 players, 4 hours a month | Silver $4.99/mo, Gold $9.99/mo per player (2021, [Making Music](https://makingmusic.org.uk/node/15464)); current prices behind sign-in | Unlimited session length, more players, better audio, video, recording (2021) |
| [Audiomovers ListenTo](https://audiomovers.com/pricing) | 7-day trial only | Basic $12.99/mo or $99.99/yr; Pro $24.99/mo or $199.99/yr; Business $275/yr | Basic: 16 channels, 10 listeners. Pro: 128 channels, 150 listeners, MIDI streaming, talkback, guest pass |
| Muse | 1-hour sessions | $4.29/mo ([WeRaveYou](https://weraveyou.com/tech/best-softwares-remote-music-collaboration/)) | Longer sessions |
| LANDR Sessions | None | $10/mo ([WeRaveYou](https://weraveyou.com/tech/best-softwares-remote-music-collaboration/)) | Whole product |
| [SonoBus](https://www.sonobus.net), Jamulus | Everything (open source) | None | — |
| [Satellite](https://mixedinkey.com/faq/satellite-plugins/) | Everything for now; guests join free, "unlimited guests" | "Pro" planned, no price yet | Not announced; a "permanent free tier" is promised |

The direct band tools cluster at **$5 to €8 a month** per person, or **€20 a month for a whole band** (Zoundroom). Prices are from each vendor's page except where another source is linked. SoundBridge and JamKazam show current prices only after sign-in.

## Adjacent tools

These solve live playing or DAW-to-DAW streaming, not async band recording. They matter for PYL's DAW route and MIDI plans, and many PYL players will already own one.

| Product | What it does | Platform |
| --- | --- | --- |
| [JamKazam](https://jamkazam.com) | Live jamming with audio + video, about 10,000 backing tracks, stream to YouTube/Twitch | Desktop |
| [SonoBus](https://www.sonobus.net) | Peer-to-peer low-latency audio, uncompressed or Opus; no encryption | Mac, Win, Linux, iOS, Android; AU/VST/AAX |
| Jamulus | Server-based live jamming; open source, latest release 3.12.5 (Aug 2026) | Desktop |
| [Audiomovers](https://audiomovers.com) ListenTo | Streams DAW output to a browser, up to 32-bit/192 kHz | DAW plugin + browser |
| [SoundBridge](https://www.soundbridge.io) | DAW with sync-locked remote tracking and stem transfer to a peer's timeline | Mac, Windows |
| Muse | Real-time remote audio/MIDI into connected DAWs; slows past 4 users | DAW |
| LANDR Sessions | Uncompressed DAW audio in calls, timestamped comments | Web + plugin |
| [Satellite](https://mixedinkey.com/satellite/) (Mixed In Key) | Plugins that share stems and MIDI between producers' DAWs; syncs BPM, key, time signature and sample rate; lossless audio; roles Host, Co-Host, VIP, Guest. Real-time or async | Mac, Windows; Ableton, Logic, FL Studio, Cubase, Studio One, Pro Tools |

PYL's README already explains why it stays async (100–300 ms network delay vs the 20–30 ms musicians tolerate). Audiomovers shows DAW bridges can be sold; Satellite shows a strong one can also be given away free. Both support the "companion plugin, later" idea in `RESEARCH-local-daw-routing.md`.

## Where PYL stands

PYL is the deepest studio among the band tools and the only one with enforced part ownership. It trails on reach and cost of running.

**Where PYL leads**

1. **One owner per part.** Four roles and "nobody touches a player's recordings but that player", enforced in the database. JamUJam, Zoundroom and Kompoz describe nothing this strict. Satellite has session roles (Host, Co-Host, VIP, Guest), but they control who can upload or delete, not who owns a part.
2. **A real studio.** Master, groups, effects, tuner, quantise, non-destructive clips. The band tools above are players with comments; Zoundroom calls itself "not a full DAW".
3. **Feedback where the music is.** Notes pinned to bars and channels, @tags, done/reopen, notices. On par with Soundtrap's and Zoundroom's timestamped comments.
4. **Coming from a DAW.** Stem drops with BWF placement and the virtual-cable guide already work; MIDI with built-in instruments is specced.
5. **Design.** A calm, precise studio UI versus dated (Kompoz) or busy social (BandLab) competitors.

**Where PYL trails**

1. **Mobile.** BandLab, Soundtrap and Zoundroom have apps. PYL is desktop-first and not installable.
2. **Finding musicians.** BandLab, Kompoz and Vampr have communities. PYL needs a band before you start.
3. **Sounds and AI.** Soundtrap's 39,620+ loops and BandLab's AI tools set expectations PYL doesn't try to meet.
4. **Running cost.** Competitors give storage away; PYL is on the Supabase Free plan and went over its egress quota last cycle. Stereo and multi-stem drops make this worse.

## Open questions

- [ ] Who is PYL for first: hobby bands, session players, or teachers with students?
- [ ] Stay invite-only, or add "find a player for this channel"?
- [ ] Try JamUJam and Zoundroom hands-on to confirm how their roles and takes really work.

## Sources

PYL facts: `README.md` and `STATUS.md` in the project folder (Oct 21, 2026). Vendor pages marked (vendor) compare their own product.

- [JamUJam](https://www.jamujam.com/en)
- [Zoundroom — Apps for bands 2026](https://zoundroom.com/en/blog/apps-for-bands-2026-compose-record-organize) (vendor)
- [KollabMe — 9 best music collaboration apps 2026](https://www.kollabme.com/blog/best-music-collaboration-apps/) (vendor)
- [BandVolt](https://bandvolt.com/)
- [Kompoz](https://www.kompoz.com)
- [BandLab — Membership pricing](https://www.bandlab.com/membership-pricing)
- [BandLab — Membership](https://www.bandlab.com/membership)
- [Capterra — Soundtrap pricing](https://www.capterra.com/p/209734/Soundtrap/pricing/)
- [University of Leeds — Collaborating in Soundtrap](https://desystemshelp.leeds.ac.uk/podcasting-student/collaborating-in-soundtrap/)
- [Audiotool](https://www.audiotool.com)
- [SoundBridge](https://www.soundbridge.io)
- [SoundBridge — Cloud-based DAWs 2026 guide](https://soundbridge.io/cloud-based-daw-your-2026-collaboration-guide) (vendor)
- [WeRaveYou — Best remote music collaboration tools 2026](https://weraveyou.com/tech/best-softwares-remote-music-collaboration/)
- [JamKazam](https://jamkazam.com)
- [SonoBus](https://www.sonobus.net)
- [Audiomovers](https://audiomovers.com)
- [Vampr](https://vampr.me)
- [Mixed In Key — Satellite](https://mixedinkey.com/satellite/)
- [Mixed In Key — Satellite FAQ](https://mixedinkey.com/faq/satellite-plugins/) (last updated Sep 2024)
- [Soundtrap — Pricing](https://www.soundtrap.com/pricing)
- [Kompoz — Pricing](https://www.kompoz.com/pricing)
- [Audiomovers — Pricing](https://audiomovers.com/pricing)
- [Making Music — JamKazam review](https://makingmusic.org.uk/node/15464) (March 2021)
- [Jamulus releases](https://github.com/jamulussoftware/jamulus/releases)
