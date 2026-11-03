/// <reference lib="webworker" />
/**
 * Runs song analysis off the main thread so the scene keeps rendering
 * smoothly (important in VR) while a song is being imported.
 */
import { analyze } from './analyze.js';

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const result = analyze(e.data.samples, e.data.sampleRate);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
