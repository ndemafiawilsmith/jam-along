/**
 * The player's own songs: import an audio file, detect its tempo, beat and
 * key, and keep it in the browser (IndexedDB) so it's there next time.
 *
 * Files never leave the device: decoding and analysis happen locally.
 */

import AnalyzeWorker from './analyze-worker.ts?worker';
import type { Analysis } from './analyze.js';
import { music } from './engine.js';
import { keyName, makeImportedSong, Song } from './songs.js';

const DB_NAME = 'jam-along';
const STORE = 'songs';
const MAX_SONGS = 8;
const MAX_BYTES = 60 * 1024 * 1024;
const ANALYSIS_RATE = 11025;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4)$/i;

interface StoredSong {
  id: string;
  name: string;
  file: Blob;
  duration: number;
  bpm: number;
  beatOffset: number;
  keyRoot: number;
  mode: 'major' | 'minor';
  added: number;
}

// ------------------------------------------------------------ storage

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Stored files by song id, so audio can be decoded when first played. */
const files = new Map<string, Blob>();

function songFromStored(r: StoredSong): Song {
  return makeImportedSong({
    id: r.id,
    name: r.name,
    duration: r.duration,
    bpm: r.bpm,
    beatOffset: r.beatOffset,
    keyRoot: r.keyRoot,
    mode: r.mode,
  });
}

/** Load the player's saved songs into the song list. Safe to call once at startup. */
export async function loadSavedSongs(): Promise<void> {
  music.loadAudio = async (song) => {
    const id = song.imported?.id;
    const file = id ? files.get(id) : undefined;
    if (!file) throw new Error('missing audio');
    return music.decode(await file.arrayBuffer());
  };
  try {
    const all = await withStore<StoredSong[]>('readonly', (s) => s.getAll() as IDBRequest<StoredSong[]>);
    all.sort((a, b) => a.added - b.added);
    for (const r of all) {
      files.set(r.id, r.file);
      music.addSong(songFromStored(r));
    }
  } catch {
    // Storage can be unavailable (private browsing, blocked site data).
    // Importing still works for this session.
  }
}

// ------------------------------------------------------------ analysis

/** Downmix to mono and resample to 11 kHz: plenty for tempo and key. */
async function toAnalysisSamples(audio: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(audio.duration * ANALYSIS_RATE));
  const offline = new OfflineAudioContext(1, length, ANALYSIS_RATE);
  const src = offline.createBufferSource();
  src.buffer = audio;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

function runAnalysis(samples: Float32Array): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new AnalyzeWorker();
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: Analysis; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? 'analysis failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ samples, sampleRate: ANALYSIS_RATE }, [samples.buffer]);
  });
}

// ------------------------------------------------------------ import

let busy = false;

function titleFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return base || 'My song';
}

function isAudio(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
}

/** Import one audio file: decode, analyse, save, and select it. */
export async function importFile(file: File): Promise<void> {
  if (busy) {
    music.setStatus('Still importing the last song…', 2500);
    return;
  }
  if (!isAudio(file)) {
    music.setStatus("That isn't an audio file. Try MP3, M4A or WAV", 5000);
    return;
  }
  if (file.size > MAX_BYTES) {
    music.setStatus('That file is too big (60 MB max)', 5000);
    return;
  }
  busy = true;
  const name = titleFromFile(file);
  try {
    music.setStatus(`Reading ${name}…`);
    const audio = await music.decode(await file.arrayBuffer());
    if (audio.duration < 10) {
      music.setStatus('That clip is too short. Use a full song', 5000);
      return;
    }
    music.setStatus('Finding the beat and key…');
    const result = await runAnalysis(await toAnalysisSamples(audio));

    // Keep tempos in a comfortable range for nodding along.
    let bpm = result.bpm;
    while (bpm > 165) bpm /= 2;
    while (bpm < 65) bpm *= 2;

    const stored: StoredSong = {
      id: `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      file,
      duration: audio.duration,
      bpm,
      beatOffset: result.beatOffset % (60 / bpm),
      keyRoot: result.keyRoot,
      mode: result.mode,
      added: Date.now(),
    };
    files.set(stored.id, file);
    const song = songFromStored(stored);
    const index = music.addSong(song, audio);
    try {
      await withStore('readwrite', (s) => s.put(stored));
      await trimLibrary();
    } catch {
      // Not saved (storage full or blocked); still playable this session.
    }
    music.setSong(music.songs.indexOf(song) >= 0 ? music.songs.indexOf(song) : index);
    music.setStatus(`Ready · ${keyName(song)} · ${Math.round(bpm)} BPM`, 5000);
  } catch {
    music.setStatus("Couldn't read that file. Try MP3, M4A or WAV", 6000);
  } finally {
    busy = false;
  }
}

/** Keep only the newest MAX_SONGS imported songs. */
async function trimLibrary(): Promise<void> {
  const imported = music.songs.filter((s) => s.imported);
  const extra = imported.length - MAX_SONGS;
  for (let i = 0; i < extra; i++) {
    const id = imported[i].imported!.id;
    files.delete(id);
    music.removeSong(id);
    await withStore('readwrite', (s) => s.delete(id));
  }
}

// ------------------------------------------------------------ pickers

let input: HTMLInputElement | null = null;

function ensureInput(): HTMLInputElement {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'jam-import-input';
    input.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input?.files?.[0];
      if (file) void importFile(file);
      if (input) input.value = '';
    });
    document.body.appendChild(input);
  }
  return input;
}

/** Open the system file picker. Call from a click or tap. */
export function pickFile(): void {
  music.unlock();
  ensureInput().click();
}

/** Let people drop an audio file anywhere on the page. Returns a cleanup. */
export function enableDropImport(): () => void {
  ensureInput();
  const over = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };
  const drop = (e: DragEvent): void => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    music.unlock();
    void importFile(file);
  };
  window.addEventListener('dragover', over);
  window.addEventListener('drop', drop);
  return () => {
    window.removeEventListener('dragover', over);
    window.removeEventListener('drop', drop);
  };
}
