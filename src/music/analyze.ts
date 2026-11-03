/**
 * Tempo, beat and key detection for imported songs.
 *
 * Pure functions with no DOM or Web Audio, so they run in a Web Worker (and
 * in Node for testing). Input is mono audio, ideally resampled to ~11 kHz.
 *
 * - Tempo: spectral-flux onset envelope -> autocorrelation for a rough tempo
 *   -> fine comb search that locks tempo AND the first-beat offset together,
 *   so the beat grid stays in sync across the whole song.
 * - Key: frame-normalised chromagram correlated with Temperley key profiles.
 *   Mixing up a key with its relative major/minor is harmless for us, since
 *   both share the same pentatonic scale.
 */

export interface Analysis {
  bpm: number;
  /** Seconds from the start of the audio to the first beat of the grid. */
  beatOffset: number;
  /** Pitch class of the key's tonic, 0 = C. */
  keyRoot: number;
  mode: 'major' | 'minor';
  /** 0..1, rough confidence in the key choice. */
  keyConfidence: number;
}

// ------------------------------------------------------------------ FFT

class FFT {
  readonly n: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  readonly re: Float32Array;
  readonly im: Float32Array;

  constructor(n: number) {
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
  }

  /** Transform `input` (length n, already windowed) into re/im in place. */
  run(input: Float32Array): void {
    const { n, re, im, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      re[rev[i]] = input[i];
      im[i] = 0;
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step];
          const s = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// ------------------------------------------------------------------ tempo

const ONSET_N = 1024;
const ONSET_HOP = 128;
/** Only the first part of the song is needed to lock the beat grid. */
const TEMPO_SECONDS = 150;

function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const fft = new FFT(ONSET_N);
  const win = hann(ONSET_N);
  const frame = new Float32Array(ONSET_N);
  const bins = ONSET_N / 2;
  const prev = new Float32Array(bins);
  const cur = new Float32Array(bins);
  const end = Math.min(samples.length, Math.floor(TEMPO_SECONDS * sampleRate));
  const frames = Math.max(0, Math.floor((end - ONSET_N) / ONSET_HOP));
  const flux = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * ONSET_HOP;
    for (let i = 0; i < ONSET_N; i++) frame[i] = samples[off + i] * win[i];
    fft.run(frame);
    let sum = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(fft.re[k], fft.im[k]));
      cur[k] = mag;
      const d = mag - prev[k];
      if (d > 0) sum += d;
    }
    prev.set(cur);
    flux[f] = f === 0 ? 0 : sum;
  }

  // Remove the slowly changing loudness so only the "hits" remain.
  const fps = sampleRate / ONSET_HOP;
  const radius = Math.max(1, Math.round(fps * 0.25));
  const env = new Float32Array(frames);
  let acc = 0;
  for (let i = 0; i < Math.min(frames, radius); i++) acc += flux[i];
  for (let f = 0; f < frames; f++) {
    const add = f + radius;
    const drop = f - radius - 1;
    if (add < frames) acc += flux[add];
    if (drop >= 0) acc -= flux[drop];
    const count = Math.min(frames - 1, f + radius) - Math.max(0, f - radius) + 1;
    const v = flux[f] - acc / count;
    env[f] = v > 0 ? v : 0;
  }
  let max = 0;
  for (let f = 0; f < frames; f++) if (env[f] > max) max = env[f];
  if (max > 0) for (let f = 0; f < frames; f++) env[f] /= max;
  return env;
}

function sampleAt(env: Float32Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const t = x - i;
  return env[i] * (1 - t) + env[i + 1] * t;
}

/** Strength of a beat grid with period `p` frames starting at `phase`. */
function combScore(env: Float32Array, p: number, phase: number): number {
  let s = 0;
  for (let x = phase; x < env.length - 1; x += p) {
    // On-beats count fully, off-beats (8th notes) a little.
    s += sampleAt(env, x) + 0.25 * sampleAt(env, x + p / 2);
  }
  return s;
}

function detectTempo(env: Float32Array, fps: number): { bpm: number; offset: number } {
  const minBpm = 60;
  const maxBpm = 190;
  const lagMin = Math.floor((60 * fps) / maxBpm);
  const lagMax = Math.ceil((60 * fps) / minBpm);
  const n = env.length;
  if (n < lagMax * 4) return { bpm: 120, offset: 0 };

  // 1) Autocorrelation with a gentle preference for common tempos (~115 BPM).
  const ac = new Float32Array(lagMax + 2);
  for (let lag = lagMin; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (n - lag);
  }
  let bestLag = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin + 1; lag <= lagMax; lag++) {
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const bpm = (60 * fps) / lag;
    const octaves = Math.log2(bpm / 115);
    const prior = Math.exp(-0.5 * (octaves / 0.75) ** 2);
    // Reward lags whose double also lines up: real beats repeat.
    const dbl = 2 * lag <= lagMax + 1 ? ac[2 * lag] : ac[lag];
    const score = (ac[lag] + 0.5 * dbl) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // 2) Fine comb search around that tempo for an exact period and phase.
  let bestP = bestLag;
  let bestPhase = 0;
  let best = -Infinity;
  for (let p = bestLag * 0.96; p <= bestLag * 1.04; p += 0.02) {
    for (let phase = 0; phase < p; phase += 0.5) {
      const s = combScore(env, p, phase);
      if (s > best) {
        best = s;
        bestP = p;
        bestPhase = phase;
      }
    }
  }
  // Polish the phase at a finer step.
  for (let phase = bestPhase - 0.5; phase <= bestPhase + 0.5; phase += 0.05) {
    if (phase < 0) continue;
    const s = combScore(env, bestP, phase);
    if (s > best) {
      best = s;
      bestPhase = phase;
    }
  }

  // Spectral flux peaks when a hit reaches the steepest part of the Hann
  // window (about 3/4 of the way into the frame), so shift by that much.
  const offsetSec = (bestPhase + (ONSET_N * 0.75) / ONSET_HOP) / fps;
  const periodSec = bestP / fps;
  const bpm = 60 / periodSec;
  return { bpm, offset: ((offsetSec % periodSec) + periodSec) % periodSec };
}

// ------------------------------------------------------------------ key

const KEY_N = 4096;
const KEY_HOP = 2048;
const MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

function chromagram(samples: Float32Array, sampleRate: number): Float64Array {
  const fft = new FFT(KEY_N);
  const win = hann(KEY_N);
  const frame = new Float32Array(KEY_N);
  const bins = KEY_N / 2;
  const mags = new Float32Array(bins);
  const pc = new Int8Array(bins).fill(-1);
  const lo = Math.ceil((80 * KEY_N) / sampleRate);
  const hi = Math.min(bins - 2, Math.floor((2000 * KEY_N) / sampleRate));
  for (let k = lo; k <= hi; k++) {
    const freq = (k * sampleRate) / KEY_N;
    const midi = 69 + 12 * Math.log2(freq / 440);
    pc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const total = new Float64Array(12);
  const chroma = new Float64Array(12);
  const frames = Math.max(0, Math.floor((samples.length - KEY_N) / KEY_HOP));
  for (let f = 0; f < frames; f++) {
    const off = f * KEY_HOP;
    let energy = 0;
    for (let i = 0; i < KEY_N; i++) {
      const v = samples[off + i];
      frame[i] = v * win[i];
      energy += v * v;
    }
    if (energy / KEY_N < 1e-6) continue; // skip silence
    fft.run(frame);
    for (let k = lo - 1; k <= hi + 1; k++) mags[k] = Math.hypot(fft.re[k], fft.im[k]);
    chroma.fill(0);
    for (let k = lo; k <= hi; k++) {
      // Only spectral peaks count: they are the actual notes.
      if (mags[k] > mags[k - 1] && mags[k] >= mags[k + 1]) chroma[pc[k]] += Math.sqrt(mags[k]);
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += chroma[i];
    if (sum > 0) for (let i = 0; i < 12; i++) total[i] += chroma[i] / sum;
  }
  return total;
}

function correlate(a: ArrayLike<number>, b: number[], rot: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + rot) % 12] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function detectKey(chroma: Float64Array): Pick<Analysis, 'keyRoot' | 'mode' | 'keyConfidence'> {
  const scores: Array<{ root: number; mode: 'major' | 'minor'; r: number }> = [];
  for (let root = 0; root < 12; root++) {
    scores.push({ root, mode: 'major', r: correlate(chroma, MAJOR, root) });
    scores.push({ root, mode: 'minor', r: correlate(chroma, MINOR, root) });
  }
  scores.sort((x, y) => y.r - x.r);
  const best = scores[0];
  // Confidence against the best key that does NOT share the same notes.
  const relative = (s: (typeof scores)[number]): number =>
    s.mode === 'major' ? (s.root + 9) % 12 : (s.root + 3) % 12;
  const rival = scores.find(
    (s) => !(s.root === best.root && s.mode === best.mode) &&
      !(s.mode !== best.mode && s.root === relative(best)),
  );
  const gap = rival ? best.r - rival.r : best.r;
  return { keyRoot: best.root, mode: best.mode, keyConfidence: Math.max(0, Math.min(1, gap * 5)) };
}

// ------------------------------------------------------------------ main

export function analyze(samples: Float32Array, sampleRate: number): Analysis {
  const env = onsetEnvelope(samples, sampleRate);
  const { bpm, offset } = detectTempo(env, sampleRate / ONSET_HOP);
  const key = detectKey(chromagram(samples, sampleRate));
  return { bpm, beatOffset: offset, ...key };
}
