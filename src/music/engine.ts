/**
 * Jam Along music engine.
 *
 * Plain Web Audio, no ECS: it generates the backing band live (drums, bass,
 * chords), plays the player's notes, and records when every hit happened so
 * the visual systems can react to the music in sync.
 */

import { keyboardNotes, Song, SONGS } from './songs.js';

export type HitType = 'kick' | 'snare' | 'hat' | 'bass' | 'chord' | 'player';
export type Sound = 'Keys' | 'Synth' | 'Bells';
export const SOUNDS: Sound[] = ['Keys', 'Synth', 'Bells'];

export const KEY_COUNT = 11;

const HIT_TYPES: HitType[] = ['kick', 'snare', 'hat', 'bass', 'chord', 'player'];
const RING = 32;
const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of time
const TICK_MS = 25;

function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class HitLog {
  times = new Float64Array(RING).fill(-1);
  head = 0;
  push(t: number): void {
    this.times[this.head] = t;
    this.head = (this.head + 1) % RING;
  }
  /** Most recent hit that has already sounded (time <= now). */
  last(now: number): number {
    let best = -1;
    for (let i = 0; i < RING; i++) {
      const t = this.times[i];
      if (t <= now && t > best) best = t;
    }
    return best;
  }
}

export class MusicEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  freqData = new Uint8Array(64);

  songIndex = 0;
  soundIndex = 0;
  playing = false;

  private master!: GainNode;
  private bandBus!: GainNode;
  private playerBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private startTime = 0;
  private logs = new Map<HitType, HitLog>();
  private listeners = new Set<() => void>();
  notes: number[] = keyboardNotes(SONGS[0], KEY_COUNT);

  constructor() {
    for (const t of HIT_TYPES) this.logs.set(t, new HitLog());
  }

  get song(): Song {
    return SONGS[this.songIndex];
  }

  get sound(): Sound {
    return SOUNDS[this.soundIndex];
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Subscribe to state changes (song, sound, play/stop). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** Create or resume audio. Must run from a user gesture the first time. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.75;
      this.master.connect(comp).connect(this.analyser).connect(ctx.destination);

      this.bandBus = ctx.createGain();
      this.bandBus.gain.value = 0.75;
      this.bandBus.connect(this.master);
      this.playerBus = ctx.createGain();
      this.playerBus.gain.value = 0.9;
      this.playerBus.connect(this.master);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.28;
      this.reverb.connect(wet).connect(this.master);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    return buf;
  }

  // ---- Transport -------------------------------------------------------

  togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  play(): void {
    this.unlock();
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.startTime = this.nextStepTime;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    this.emit();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.emit();
  }

  setSong(index: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.songIndex = (index + SONGS.length) % SONGS.length;
    this.notes = keyboardNotes(this.song, KEY_COUNT);
    if (wasPlaying) this.play();
    else this.emit();
  }

  nextSong(): void {
    this.setSong(this.songIndex + 1);
  }

  prevSong(): void {
    this.setSong(this.songIndex - 1);
  }

  nextSound(): void {
    this.soundIndex = (this.soundIndex + 1) % SOUNDS.length;
    this.emit();
  }

  /** Seconds per 16th-note step. */
  get stepDur(): number {
    return 60 / this.song.bpm / 4;
  }

  /** Position within the current beat, 0..1 (0 = on the beat). */
  beatPhase(): number {
    if (!this.playing || !this.ctx) return 0;
    const beat = (this.ctx.currentTime - this.startTime) / (this.stepDur * 4);
    return beat - Math.floor(beat);
  }

  /** Index of the current chord in the loop (changes once per bar). */
  barIndex(): number {
    if (!this.playing || !this.ctx) return 0;
    const bar = Math.floor(
      (this.ctx.currentTime - this.startTime) / (this.stepDur * 16),
    );
    return Math.max(0, bar) % this.song.chords.length;
  }

  /** Seconds since the last hit of a type (Infinity if none). */
  since(type: HitType): number {
    const now = this.now;
    const t = this.logs.get(type)!.last(now);
    return t < 0 ? Infinity : now - t;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      const s = this.step % 16;
      const swing = s % 2 === 1 ? this.song.swing * this.stepDur : 0;
      this.playStep(this.step, this.nextStepTime + swing);
      this.nextStepTime += this.stepDur;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const song = this.song;
    const s = step % 16;
    const bar = Math.floor(step / 16) % song.chords.length;
    const chord = song.chords[bar];

    if (song.kick.includes(s)) this.kick(t);
    if (song.snare.includes(s)) this.snare(t);
    if (song.clap.includes(s)) this.clap(t);
    if (song.rim.includes(s)) this.rim(t);
    if (song.hat.includes(s)) this.hat(t, s % 4 === 2 ? 0.22 : 0.12);

    for (const [bs, interval] of song.bass) {
      if (bs === s) {
        const midi = song.rootMidi + chord.root + interval;
        this.bass(t, midi, this.stepDur * 1.8);
      }
    }
    if (s === 0) {
      this.pad(t, song.rootMidi + 24 + chord.root, chord.tones, this.stepDur * 16);
    }
  }

  // ---- Band instruments --------------------------------------------------

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.env(t, 1, 0.003, 0.32);
    o.connect(g).connect(this.bandBus);
    o.start(t);
    o.stop(t + 0.4);
    this.logs.get('kick')!.push(t);
  }

  private noiseHit(
    t: number,
    type: BiquadFilterType,
    freq: number,
    peak: number,
    decay: number,
    toReverb = false,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.env(t, peak, 0.002, decay);
    src.connect(f).connect(g).connect(this.bandBus);
    if (toReverb) g.connect(this.reverb);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1800, 0.55, 0.18, true);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = this.env(t, 0.35, 0.002, 0.1);
    o.connect(g).connect(this.bandBus);
    o.start(t);
    o.stop(t + 0.15);
    this.logs.get('snare')!.push(t);
  }

  private clap(t: number): void {
    for (let i = 0; i < 3; i++) {
      this.noiseHit(t + i * 0.011, 'bandpass', 1200, 0.4, 0.06 + i * 0.04, i === 2);
    }
    this.logs.get('snare')!.push(t);
  }

  private rim(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 820;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1600;
    const g = this.env(t, 0.18, 0.001, 0.04);
    o.connect(f).connect(g).connect(this.bandBus);
    o.start(t);
    o.stop(t + 0.06);
  }

  private hat(t: number, peak: number): void {
    this.noiseHit(t, 'highpass', 8000, peak, 0.045);
    this.logs.get('hat')!.push(t);
  }

  private bass(t: number, midi: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const sub = ctx.createOscillator();
    sub.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    f.Q.value = 3;
    const g = this.env(t, 0.45, 0.005, dur);
    o.connect(f);
    sub.connect(f);
    f.connect(g).connect(this.bandBus);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.05);
    sub.stop(t + dur + 0.05);
    this.logs.get('bass')!.push(t);
  }

  private pad(t: number, rootMidi: number, tones: number[], dur: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.25);
    g.gain.setValueAtTime(0.09, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    f.connect(g);
    g.connect(this.bandBus);
    g.connect(this.reverb);
    for (const tone of tones) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(rootMidi + tone);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
    this.logs.get('chord')!.push(t);
  }

  // ---- The player's instrument ------------------------------------------

  /** Play keyboard key `index` right now. Returns false if audio is locked. */
  playKey(index: number, velocity = 1): boolean {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return false;
    const midi = this.notes[Math.max(0, Math.min(this.notes.length - 1, index))];
    const t = ctx.currentTime + 0.005;
    const v = 0.25 + 0.75 * Math.max(0, Math.min(1, velocity));
    const out = ctx.createGain();
    out.gain.value = v;
    out.connect(this.playerBus);
    out.connect(this.reverb);

    switch (this.sound) {
      case 'Keys': {
        // Electric-piano style: a sine with a fast-decaying FM "tine".
        const car = ctx.createOscillator();
        car.frequency.value = mtof(midi);
        const mod = ctx.createOscillator();
        mod.frequency.value = mtof(midi) * 7;
        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(mtof(midi) * 1.2, t);
        modGain.gain.exponentialRampToValueAtTime(1, t + 0.4);
        mod.connect(modGain).connect(car.frequency);
        const g = this.env(t, 0.5, 0.004, 1.4);
        car.connect(g).connect(out);
        car.start(t);
        mod.start(t);
        car.stop(t + 1.5);
        mod.stop(t + 1.5);
        break;
      }
      case 'Synth': {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(4200, t);
        f.frequency.exponentialRampToValueAtTime(700, t + 0.45);
        const g = this.env(t, 0.3, 0.01, 0.7);
        f.connect(g).connect(out);
        for (const d of [-9, 9]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(midi);
          o.detune.value = d;
          o.connect(f);
          o.start(t);
          o.stop(t + 0.8);
        }
        break;
      }
      case 'Bells': {
        for (const [ratio, amp, dec] of [
          [1, 0.35, 1.8],
          [2.76, 0.12, 0.9],
          [5.4, 0.06, 0.5],
        ]) {
          const o = ctx.createOscillator();
          o.frequency.value = mtof(midi + 12) * ratio;
          const g = this.env(t, amp, 0.002, dec);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + dec + 0.05);
        }
        break;
      }
    }
    this.logs.get('player')!.push(t);
    return true;
  }

  /** Refresh analyser data; call once per frame. Returns overall loudness 0..1. */
  sample(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return sum / (this.freqData.length * 255);
  }
}

/** One shared engine for the whole app. */
export const music = new MusicEngine();
