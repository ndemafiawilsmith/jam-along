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

Desktop shortcuts: `Space` play/stop, `N` / `B` next/previous song, `M` change sound.

## Project layout

- `src/music/songs.ts` – the three built-in songs (tempo, key, chords, drum patterns)
- `src/music/engine.ts` – Web Audio engine: backing band + the player's instrument
- `src/jam-system.ts` – keyboard, control buttons, fingertip and pinch input, sparks
- `src/show-system.ts` – the band, light beams and the LED wall that reacts to the sound
- `src/stage.ts` – all the 3D geometry
