/**
 * Rigged, animated band members (e.g. converted from Mixamo).
 *
 * public/band/band.json lists the members. Each has a model with a "playing"
 * animation, an optional separate idle animation, the tempo the animation was
 * performed at (so it can be sped up or slowed down to match each song), and
 * an optional instrument attached to one of its bones.
 *
 * If the file or a model is missing, that member simply keeps its procedural
 * stand-in figure.
 */

import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  AssetManager,
  Box3,
  Euler,
  Group,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
} from '@iwsdk/core';
// Same module the SDK uses internally (vite dedupes three), for cloning skinned models.
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildInstrument, InstrumentKind } from './instruments.js';
import { PerformerRig } from './performer.js';

export interface MemberConfig {
  role: string;
  model: string;
  /** Optional file whose first animation is used while the music is stopped. */
  idle?: string;
  /** Name (or part of the name) of the playing clip; defaults to the first clip. */
  clip?: string;
  /** Tempo the playing animation was performed at; the clip is scaled to each song's BPM. */
  clipBpm?: number;
  /** Final height of the character in metres (the model is scaled to fit). */
  height?: number;
  /** Extra offset from the stage spot, in metres (x right, y up, z toward the player). */
  offset?: [number, number, number];
  /** Extra turn around Y, in degrees. */
  turn?: number;
  /**
   * "singer": ignore the model's own animation and perform procedurally
   * (mic at the mouth, sway, gestures, jaw). For rigs without music clips.
   */
  rig?: 'clip' | 'singer' | 'guitar' | 'bass' | 'drums';
  instrument?: {
    kind: InstrumentKind;
    /** Bone to attach to; a name fragment such as "Spine2" or "RightHand". */
    bone?: string;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: number;
  };
}

export interface BandRig {
  root: Group;
  update(delta: number, playing: boolean, bpm: number): void;
}

const BASE = `${import.meta.env.BASE_URL}band/`;

function findBone(root: Object3D, fragment: string): Object3D | null {
  let found: Object3D | null = null;
  const want = fragment.toLowerCase();
  root.traverse((o) => {
    if (!found && (o as { isBone?: boolean }).isBone && o.name.toLowerCase().endsWith(want)) found = o;
  });
  if (!found) {
    root.traverse((o) => {
      if (!found && (o as { isBone?: boolean }).isBone && o.name.toLowerCase().includes(want)) found = o;
    });
  }
  return found;
}

/** Remove root motion so a looping clip stays on its spot on stage. */
function stripRootMotion(clip: AnimationClip): void {
  for (const track of clip.tracks) {
    if (!/hips\.position$/i.test(track.name)) continue;
    const v = track.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}

async function buildRig(cfg: MemberConfig): Promise<BandRig> {
  const gltf = await AssetManager.loadGLTF(BASE + cfg.model);
  // Loaded models are cached and shared: give every band member its own copy.
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          // Stage-friendly look: slightly glossy skin and fabric.
          std.roughness = Math.min(std.roughness, 0.75);
          std.metalness = 0;
        }
      }
    }
  });

  // Scale to the requested height using the bind pose.
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const height = cfg.height ?? 1.76;
  const s = size.y > 0 ? height / size.y : 1;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;

  if (cfg.rig && cfg.rig !== 'clip') {
    const perf = new PerformerRig(model, cfg.rig);
    if (!perf.ok) throw new Error(`rig is missing the bones a procedural ${cfg.rig} needs`);
    perf.root.name = `Band ${cfg.role}`;
    if (cfg.offset) model.position.add(new Vector3(cfg.offset[0], cfg.offset[1], cfg.offset[2]));
    if (cfg.turn) perf.root.rotation.y = (cfg.turn * Math.PI) / 180;
    const holder = new Group();
    holder.add(perf.root);
    return { root: holder, update: (delta) => perf.update(delta) };
  }

  const root = new Group();
  root.name = `Band ${cfg.role}`;
  const inner = new Group();
  inner.add(model);
  if (cfg.offset) inner.position.set(cfg.offset[0], cfg.offset[1], cfg.offset[2]);
  if (cfg.turn) inner.rotation.y = (cfg.turn * Math.PI) / 180;
  root.add(inner);

  // Instrument, attached to a bone so it moves with the performance.
  if (cfg.instrument) {
    const inst = buildInstrument(cfg.instrument.kind);
    const bone = cfg.instrument.bone ? findBone(model, cfg.instrument.bone) : null;
    const parent = bone ?? inner;
    const p = cfg.instrument.position ?? [0, 0, 0];
    const r = cfg.instrument.rotation ?? [0, 0, 0];
    inst.position.set(p[0], p[1], p[2]);
    inst.rotation.copy(new Euler((r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180));
    // Bones live inside the scaled model; undo that scale for the instrument.
    const k = (cfg.instrument.scale ?? 1) / (bone ? s * worldScaleOfParents(bone, model) : 1);
    inst.scale.setScalar(k);
    parent.add(inst);
  }

  const mixer = new AnimationMixer(model);
  const clips = gltf.animations;
  const playClip =
    (cfg.clip && clips.find((c) => c.name.toLowerCase().includes(cfg.clip!.toLowerCase()))) || clips[0];
  let play: AnimationAction | null = null;
  if (playClip) {
    stripRootMotion(playClip);
    play = mixer.clipAction(playClip);
    play.setLoop(LoopRepeat, Infinity);
    play.play();
  }
  let idle: AnimationAction | null = null;
  if (cfg.idle) {
    try {
      const idleGltf = await AssetManager.loadGLTF(BASE + cfg.idle);
      const clip = idleGltf.animations[0];
      if (clip) {
        stripRootMotion(clip);
        idle = mixer.clipAction(clip);
        idle.setLoop(LoopRepeat, Infinity);
        idle.play();
        idle.setEffectiveWeight(0);
      }
    } catch {
      // No idle: the playing clip runs slowly instead.
    }
  }

  const clipBpm = cfg.clipBpm ?? 100;
  let wasPlaying: boolean | null = null;
  return {
    root,
    update(delta, playing, bpm) {
      if (wasPlaying !== playing && play) {
        if (idle) {
          if (playing) idle.crossFadeTo(play.reset().play(), 0.6, false);
          else play.crossFadeTo(idle.reset().play(), 0.8, false);
        }
        wasPlaying = playing;
      }
      if (play) {
        // Match the performance to the song's tempo (within a natural range).
        play.timeScale = playing ? Math.min(1.35, Math.max(0.75, bpm / clipBpm)) : idle ? 1 : 0.25;
      }
      mixer.update(delta);
    },
  };
}

/** Product of the scales between a bone and the model root (Mixamo rigs often carry 0.01). */
function worldScaleOfParents(bone: Object3D, stopAt: Object3D): number {
  let k = 1;
  let o: Object3D | null = bone.parent;
  while (o && o !== stopAt) {
    k *= o.scale.x;
    o = o.parent;
  }
  return k;
}

/**
 * Load band.json and build every member it lists. `onReady` is called for
 * each member as soon as its model is ready.
 */
export async function loadBand(onReady: (role: string, rig: BandRig) => void): Promise<void> {
  let members: MemberConfig[] = [];
  try {
    const res = await fetch(`${BASE}band.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = (await res.json()) as { members?: MemberConfig[] };
    members = data.members ?? [];
  } catch {
    return;
  }
  await Promise.all(
    members.map(async (m) => {
      try {
        onReady(m.role, await buildRig(m));
      } catch (err) {
        console.warn(`[band] could not load ${m.role} (${m.model}); keeping the stand-in figure`, err);
      }
    }),
  );
}

// Keep SkinnedMesh referenced for type narrowing in future tweaks.
export type { SkinnedMesh };
