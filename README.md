# Jam Along

A hands-first WebXR music experience for Meta Quest, built with the Immersive Web SDK.
Pick a song, press Play, and play the glowing keys while a virtual band plays with you.
The keys are locked to the song's key, so every note sounds good.

## Run it

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev
```

This opens the app in a browser with the built-in XR emulator (IWER).
Click **Enter VR** on the panel, then switch the emulator to **hands** mode.

## Controls

| Where | How to play |
|---|---|
| Headset (real hands) | Tap keys with your fingertips, faster = louder |
| Emulator / controllers | Point at a key and pinch (or pull the trigger) |
| Desktop browser | Click keys, or use the keyboard: `A S D F G H J K L ; '` |

Desktop shortcuts: `Space` play/stop, `N` / `B` next/previous song, `M` change sound or drum kit, `I` switch between keys and drums (drum pads use `A S D F G H`).

## Drums mode

Tap **Keys / Drums** on the console to swap the keyboard for six drum pads (hi-hat, snare, kick, clap, tom, crash). The band's drummer steps back and copies your hits, leaving a quiet hi-hat to keep time. Two kits: Studio and 808.

## Import your own songs

Before entering VR, press **Import your own song** on the welcome panel (or drop an
audio file onto the page). MP3, M4A, WAV, OGG and FLAC all work, up to 60 MB.

Jam Along detects the song's tempo, first beat and key in the background
(usually in about a second), tunes the keyboard to that key, and syncs the band
and lights to the beat. Files never leave your device: they're decoded and
analysed locally and saved in the browser, so your last 8 songs are still there
next time.

## Project layout

- `src/music/songs.ts` – the three built-in songs (tempo, key, chords, drum patterns)
- `src/music/engine.ts` – Web Audio engine: backing band, imported songs, the player's instrument
- `src/music/analyze.ts` – tempo, beat and key detection (runs in `analyze-worker.ts`)
- `src/music/library.ts` – importing, browser storage and the file picker
- `src/jam-system.ts` – keyboard, control buttons, fingertip and pinch input, sparks
- `src/show-system.ts` – the band, light beams and the LED wall that reacts to the sound
- `src/stage.ts` – all the 3D geometry
