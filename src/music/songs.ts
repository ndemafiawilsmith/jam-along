/**
 * Built-in backing tracks. Each one is generated live by the music engine, so
 * every song has an exact tempo and key, there are no licensing issues, and
 * the band can react to every single drum hit.
 *
 * Steps are 16th notes: 16 steps = one bar of 4 beats.
 */

export type Mode = 'major' | 'minor';

export interface Chord {
  /** Semitones above the song root. */
  root: number;
  /** Chord tones as semitones above the chord root. */
  tones: number[];
}

/** Extra data for a song the player imported from their own files. */
export interface ImportedInfo {
  /** Stable id used for storage. */
  id: string;
  /** Length of the audio in seconds. */
  duration: number;
  /** Seconds from the start of the audio to the first detected beat. */
  beatOffset: number;
}

export interface Song {
  name: string;
  vibe: string;
  bpm: number;
  /** MIDI note number of the key's root, in the bass octave. */
  rootMidi: number;
  mode: Mode;
  /** Swing amount for off-beat 16ths, 0 = straight, ~0.2 = lazy groove. */
  swing: number;
  /** One chord per bar; the loop repeats. */
  chords: Chord[];
  kick: number[];
  snare: number[];
  clap: number[];
  rim: number[];
  hat: number[];
  /** Bass steps and semitones above the chord root (0 = root, 7 = fifth, 12 = octave up). */
  bass: Array<[step: number, interval: number]>;
  /** Hue (0..1) used to tint lights and the band. */
  hue: number;
  /** Present only for imported songs, which play an audio file. */
  imported?: ImportedInfo;
}

const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];

export const SONGS: Song[] = [
  {
    name: 'Lagos Lights',
    vibe: 'Afro groove',
    bpm: 104,
    rootMidi: 45, // A2
    mode: 'minor',
    swing: 0.08,
    chords: [
      { root: 0, tones: MIN7 }, // Am7
      { root: 8, tones: MAJ7 }, // Fmaj7
      { root: 3, tones: MAJ }, // C
      { root: 10, tones: MAJ }, // G
    ],
    kick: [0, 6, 8, 14],
    snare: [],
    clap: [4, 12],
    rim: [3, 7, 10, 15],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    bass: [
      [0, 0],
      [3, 0],
      [6, 7],
      [8, 12],
      [11, 7],
      [14, 0],
    ],
    hue: 0.08,
  },
  {
    name: 'Midnight Drive',
    vibe: 'Synthwave',
    bpm: 96,
    rootMidi: 40, // E2
    mode: 'minor',
    swing: 0,
    chords: [
      { root: 0, tones: MIN }, // Em
      { root: 8, tones: MAJ }, // C
      { root: 3, tones: MAJ }, // G
      { root: 10, tones: MAJ }, // D
    ],
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    clap: [],
    rim: [],
    hat: [2, 6, 10, 14],
    bass: [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 12],
      [8, 0],
      [10, 0],
      [12, 0],
      [14, 12],
    ],
    hue: 0.78,
  },
  {
    name: 'Sunday Keys',
    vibe: 'Neo-soul',
    bpm: 78,
    rootMidi: 36, // C2
    mode: 'major',
    swing: 0.18,
    chords: [
      { root: 0, tones: MAJ7 }, // Cmaj7
      { root: 9, tones: MIN7 }, // Am7
      { root: 5, tones: MAJ7 }, // Fmaj7
      { root: 7, tones: [0, 4, 7, 10] }, // G7
    ],
    kick: [0, 7, 10],
    snare: [4, 12],
    clap: [],
    rim: [14],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    bass: [
      [0, 0],
      [7, 7],
      [10, 0],
      [12, 12],
    ],
    hue: 0.55,
  },
];

const PENTATONIC: Record<Mode, number[]> = {
  minor: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 7, 9],
};

/**
 * MIDI notes for the player's keyboard: a pentatonic scale in the song's key,
 * starting two octaves above the bass root. Pentatonic notes sound good over
 * every chord in these songs, so no key is ever "wrong".
 */
export function keyboardNotes(song: Song, count: number): number[] {
  const scale = PENTATONIC[song.mode];
  const start = song.rootMidi + 24;
  const notes: number[] = [];
  for (let i = 0; i < count; i++) {
    const octave = Math.floor(i / scale.length);
    notes.push(start + octave * 12 + scale[i % scale.length]);
  }
  return notes;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function noteName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12];
}

export function keyName(song: Song): string {
  return `${noteName(song.rootMidi)} ${song.mode}`;
}

/** Pitch class of a song's key, 0 = C. */
export function keyRootOf(song: Song): number {
  return ((song.rootMidi % 12) + 12) % 12;
}

/**
 * Build a Song for an imported audio file from its analysis. The keyboard only
 * needs the key; the band follows the detected beat grid.
 */
export function makeImportedSong(opts: {
  id: string;
  name: string;
  duration: number;
  bpm: number;
  beatOffset: number;
  keyRoot: number;
  mode: Mode;
}): Song {
  let hash = 0;
  for (let i = 0; i < opts.name.length; i++) hash = (hash * 31 + opts.name.charCodeAt(i)) >>> 0;
  return {
    name: opts.name,
    vibe: 'Your music',
    bpm: opts.bpm,
    // Bass-octave root between C2 (36) and B2 (47).
    rootMidi: 36 + (((opts.keyRoot % 12) + 12) % 12),
    mode: opts.mode,
    swing: 0,
    // No chord chart for imported songs: highlight the key's home chord.
    chords: [{ root: 0, tones: opts.mode === 'major' ? MAJ : MIN }],
    kick: [],
    snare: [],
    clap: [],
    rim: [],
    hat: [],
    bass: [],
    hue: (hash % 1000) / 1000,
    imported: { id: opts.id, duration: opts.duration, beatOffset: opts.beatOffset },
  };
}
