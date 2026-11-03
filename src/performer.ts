/**
 * Procedural performances for rigged characters that have no music
 * animation of their own (e.g. scanned RenderPeople characters that only
 * ship with a walk cycle).
 *
 * The skeleton is driven in code, in time with the music engine:
 * - singer: handheld mic at the mouth, sway, free-arm gestures, jaw "sings"
 *   (wider when the player plays)
 * - guitar / bass: instrument slung across the body, fretting hand moves
 *   along the neck with the chords, picking hand strums or plucks on the beat
 * - drums: seated at the kit, sticks land on the song's real hi-hat and snare
 *   hits, right foot on the kick (and on the player's hits in drums mode)
 *
 * Works with humanoid rigs whose bones end in names such as `hip`,
 * `spine_01`, `head`, `jaw`, `upperarm_r`, `lowerarm_r`, `hand_r`,
 * `upperleg_l`, `lowerleg_l`, `foot_l` (RenderPeople / UE-style naming),
 * in a T-pose facing +Z, about 1.8 m tall in model units.
 */

import {
  Bone,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { buildInstrument } from './instruments.js';
import { music } from './music/engine.js';

export type PerformerMode = 'singer' | 'guitar' | 'bass' | 'drums';
type Side = 'l' | 'r';

interface BoneRef {
  bone: Bone;
  restLocal: Quaternion;
  restPos: Vector3;
  /** Rest orientation in model space. */
  restModel: Quaternion;
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

const BODY = [
  'hip', 'spine_01', 'spine_02', 'spine_03', 'neck', 'head', 'jaw',
  'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'upperleg_l', 'lowerleg_l', 'foot_l', 'upperleg_r', 'lowerleg_r', 'foot_r',
];
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

function findBone(root: Object3D, suffix: string): Bone | null {
  let found: Bone | null = null;
  root.traverse((o) => {
    if (!found && (o as Bone).isBone && o.name.toLowerCase().endsWith(suffix)) found = o as Bone;
  });
  return found;
}

const darkMetal = new MeshStandardMaterial({ color: 0x18181c, roughness: 0.4, metalness: 0.5 });
const brightMetal = new MeshStandardMaterial({ color: 0xcfd2d8, roughness: 0.35, metalness: 0.9 });
const stickWood = new MeshStandardMaterial({ color: 0xe0c08a, roughness: 0.55 });

/** Drum surfaces in the kit's local space (see instruments.ts drumKit). */
const KIT = {
  hat: new Vector3(-0.5, 0.84, 0.38),
  snare: new Vector3(-0.24, 0.7, 0.42),
  kickPedal: new Vector3(0.06, 0.05, 0.42),
  hatPedal: new Vector3(-0.3, 0.05, 0.3),
};

export class PerformerRig {
  readonly root = new Group();
  readonly mode: PerformerMode;
  private model: Object3D;
  private bones = new Map<string, BoneRef>();
  private modelInv = new Matrix4();
  private t = 0;
  private gesture = 0;
  private fret = 0.35;
  private props = new Group();
  private mic?: Group;
  private guitar?: Group;
  private neckLen = 0.62;
  private sticks: Group[] = [];

  // scratch
  private qA = new Quaternion();
  private qB = new Quaternion();
  private qC = new Quaternion();
  private qD = new Quaternion();
  private vA = new Vector3();
  private vB = new Vector3();
  private vC = new Vector3();
  private vD = new Vector3();
  private vE = new Vector3();

  constructor(model: Object3D, mode: PerformerMode) {
    this.mode = mode;
    this.model = model;
    this.root.add(model);
    this.root.add(this.props);
    model.updateMatrixWorld(true);
    const modelWorldInvQ = new Quaternion();
    model.getWorldQuaternion(modelWorldInvQ).invert();
    const names = [...BODY];
    for (const f of ['thumb', ...FINGERS]) {
      for (const s of ['l', 'r']) for (const n of ['01', '02', '03']) names.push(`${f}_${n}_${s}`);
    }
    for (const n of names) {
      const bone = findBone(model, n);
      if (!bone) continue;
      const restModel = new Quaternion();
      bone.getWorldQuaternion(restModel).premultiply(modelWorldInvQ);
      this.bones.set(n, { bone, restLocal: bone.quaternion.clone(), restPos: bone.position.clone(), restModel });
    }

    if (mode === 'singer') this.buildMic();
    if ((mode === 'guitar' || mode === 'bass') && this.bones.has('spine_01')) this.buildGuitar(mode === 'bass');
    if (mode === 'drums') this.buildDrums();
  }

  get ok(): boolean {
    const need = ['hip', 'spine_01', 'head', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l'];
    if (this.mode === 'drums') need.push('upperleg_l', 'lowerleg_l', 'foot_l', 'upperleg_r', 'lowerleg_r', 'foot_r');
    return need.every((n) => this.bones.has(n));
  }

  // ------------------------------------------------------------ props

  private buildMic(): void {
    const mic = new Group();
    const body = new Mesh(new CylinderGeometry(0.016, 0.012, 0.17, 14), darkMetal);
    body.position.y = -0.04;
    mic.add(body);
    const ball = new Mesh(new SphereGeometry(0.027, 16, 12), brightMetal);
    ball.position.y = 0.065;
    mic.add(ball);
    this.props.add(mic);
    this.mic = mic;
  }

  private buildGuitar(bass: boolean): void {
    const g = buildInstrument(bass ? 'bass' : 'guitar');
    this.neckLen = bass ? 0.86 : 0.62;
    // Slung across the body: body at the right hip, neck up toward the left shoulder.
    g.position.set(-0.06, bass ? 1.0 : 1.04, 0.15);
    g.rotation.set(-0.12, 0.18, bass ? 0.42 : 0.48);
    // Ride with the torso so the guitar sways with the player.
    this.model.add(g);
    this.model.updateMatrixWorld(true);
    this.bones.get('spine_01')!.bone.attach(g);
    this.guitar = g;
  }

  private buildDrums(): void {
    const kit = buildInstrument('drums');
    this.props.add(kit);
    for (let i = 0; i < 2; i++) {
      const stick = new Group();
      const rod = new Mesh(new CylinderGeometry(0.006, 0.009, 0.4, 8), stickWood);
      rod.position.y = 0.17; // grip near the butt end
      stick.add(rod);
      this.props.add(stick);
      this.sticks.push(stick);
    }
  }

  // ------------------------------------------------------------ bone helpers

  /** Rotate a bone by `angle` around a model-space axis, relative to its rest pose (in its own frame). */
  private turn(name: string, axis: Vector3, angle: number, extra?: Quaternion): void {
    const b = this.bones.get(name);
    if (!b) return;
    this.vA.copy(axis).applyQuaternion(this.qA.copy(b.restModel).invert());
    this.qB.setFromAxisAngle(this.vA, angle);
    b.bone.quaternion.copy(b.restLocal).multiply(this.qB);
    if (extra) b.bone.quaternion.multiply(extra);
  }

  private modelPos(name: string, out: Vector3): Vector3 {
    return this.bones.get(name)!.bone.getWorldPosition(out).applyMatrix4(this.modelInv);
  }

  private toModel(world: Vector3): Vector3 {
    return world.applyMatrix4(this.modelInv);
  }

  private modelQuat(o: Object3D, out: Quaternion): Quaternion {
    o.getWorldQuaternion(out);
    this.model.getWorldQuaternion(this.qC).invert();
    return out.premultiply(this.qC);
  }

  /** Aim `name` so its child points along model-space `dir`, from its rest pose under the current parent. */
  private aim(name: string, childName: string, dir: Vector3): void {
    const b = this.bones.get(name);
    const c = this.bones.get(childName);
    if (!b || !c) return;
    b.bone.quaternion.copy(b.restLocal);
    b.bone.updateMatrixWorld(true);
    const parentQ = this.modelQuat(b.bone.parent!, this.qA);
    const restAligned = this.qB.copy(parentQ).multiply(b.restLocal);
    this.vA.copy(c.bone.position).normalize().applyQuaternion(restAligned);
    this.qC.setFromUnitVectors(this.vA, this.vB.copy(dir).normalize());
    const desired = this.qC.multiply(restAligned);
    b.bone.quaternion.copy(parentQ.invert().multiply(desired));
    b.bone.updateMatrixWorld(true);
  }

  /** Scale from a bone's local units to model space (rigs often carry 0.01 scales). */
  private boneScale(name: string): number {
    const b = this.bones.get(name)!.bone;
    const w = b.getWorldScale(new Vector3());
    const m = this.model.getWorldScale(new Vector3());
    return w.x / m.x;
  }

  /** Two-bone IK: `end` to `target` (model space), middle joint bent toward `pole`. */
  private ik(upper: string, middle: string, end: string, target: Vector3, pole: Vector3): void {
    if (!this.bones.has(upper) || !this.bones.has(middle) || !this.bones.has(end)) return;
    const l1 = this.bones.get(middle)!.bone.position.length() * this.boneScale(upper);
    const l2 = this.bones.get(end)!.bone.position.length() * this.boneScale(middle);
    const s = this.modelPos(upper, this.vD);
    const toT = this.vE.subVectors(target, s);
    const dist = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
    toT.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const poleDir = this.vC.copy(pole).sub(s);
    poleDir.addScaledVector(toT, -poleDir.dot(toT)).normalize();
    const elbow = new Vector3().copy(s).addScaledVector(toT, a).addScaledVector(poleDir, h);
    this.aim(upper, middle, elbow.clone().sub(s));
    const endT = new Vector3().copy(s).addScaledVector(toT, dist);
    this.aim(middle, end, endT.sub(elbow));
  }

  private reach(side: Side, target: Vector3, pole: Vector3): void {
    this.ik(`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`, target, pole);
  }

  private curl(side: Side, amount: number, thumb = 0): void {
    const sign = side === 'r' ? 1 : -1;
    for (const f of FINGERS) {
      for (const n of ['01', '02', '03']) this.turn(`${f}_${n}_${side}`, Z, sign * amount);
    }
    if (thumb) this.turn(`thumb_02_${side}`, Y, -sign * thumb);
  }

  /** Centre of a closed hand, in world space. */
  private grip(side: Side, out: Vector3): Vector3 {
    const hand = this.bones.get(`hand_${side}`)!.bone.getWorldPosition(this.vB);
    const mid = this.bones.get(`middle_01_${side}`)?.bone.getWorldPosition(this.vC) ?? hand;
    return out.addVectors(hand, mid).multiplyScalar(0.5);
  }

  // ------------------------------------------------------------ frame

  update(delta: number): void {
    this.t += delta;
    this.model.updateMatrixWorld(true);
    this.modelInv.copy(this.model.matrixWorld).invert();
    switch (this.mode) {
      case 'singer':
        this.updateSinger(delta);
        break;
      case 'guitar':
      case 'bass':
        if (this.guitar) this.updateGuitar(delta, this.mode === 'bass');
        break;
      case 'drums':
        this.updateDrums();
        break;
    }
  }

  private groove(): { playing: boolean; beat: number; beatN: number; pulse: number; g: number; level: number } {
    const playing = music.playing;
    const beat = music.beatPhase();
    return {
      playing,
      beat,
      beatN: music.beatIndex(),
      pulse: playing ? Math.pow(1 - beat, 2) : 0,
      g: playing ? 1 : 0.25,
      level: Math.min(1, music.sample() * 3.2),
    };
  }

  private updateSinger(delta: number): void {
    const t = this.t;
    const { playing, beat, beatN, pulse, g: groove, level } = this.groove();
    const sung = Math.exp(-music.since('player') * 7);

    const sway = Math.sin((beatN + beat) * Math.PI) * 0.07 * groove + Math.sin(t * 0.7) * 0.03;
    this.turn('hip', Y, sway * 0.6);
    this.turn('spine_01', Z, sway * 0.35);
    this.turn('spine_02', X, 0.05 + pulse * 0.03);
    this.turn('spine_03', Z, -sway * 0.25);
    this.turn('neck', X, 0.06 + pulse * 0.1 * groove);
    this.turn('head', X, -0.08 + pulse * 0.1 * groove, this.qD.setFromAxisAngle(Y, Math.sin(t * 0.5) * 0.12));

    // Jaw: syllables on the 8th notes while the band plays, wider when the player plays.
    const syll = playing ? Math.max(0, Math.sin((beatN + beat) * Math.PI * 2)) : 0;
    const open = Math.min(1, syll * 0.45 * (0.5 + level) + sung * 0.7);
    this.turn('jaw', X, -open * 0.28);

    this.model.updateMatrixWorld(true);
    const mouth = this.modelPos('head', this.vA).clone();
    mouth.y -= 0.02;
    mouth.z += 0.1;
    const micHand = new Vector3(-0.06, mouth.y - (playing ? 0.07 : 0.32), mouth.z + (playing ? 0.07 : 0.06));
    this.reach('r', micHand, new Vector3(-0.6, 0.9, -0.3));

    const want = playing ? Math.min(1, level * 1.1 + sung * 0.5) : 0;
    this.gesture += (want - this.gesture) * Math.min(1, delta * 2.5);
    const gst = this.gesture;
    const wave = Math.sin(t * 1.3) * 0.08 * gst;
    this.reach('l', new Vector3(0.3 + gst * 0.1, 0.88 + gst * 0.36 + wave, 0.1 + gst * 0.3), new Vector3(0.7, 0.6, -0.6));

    this.curl('r', 1.0, 0.6);
    this.curl('l', 0.25 + (1 - gst) * 0.2);

    // Mic sits in the right fist and points at the mouth.
    this.model.updateMatrixWorld(true);
    const grip = this.grip('r', new Vector3());
    this.root.worldToLocal(grip);
    this.mic!.position.copy(grip);
    const m = this.bones.get('head')!.bone.getWorldPosition(new Vector3());
    this.root.worldToLocal(m);
    m.y -= 0.02;
    m.z += 0.08;
    this.mic!.quaternion.setFromUnitVectors(Y, m.sub(grip).normalize());
  }

  private updateGuitar(delta: number, bass: boolean): void {
    const t = this.t;
    const { playing, beat, beatN, pulse, g } = this.groove();

    // Body: groove through the spine, head nods, glances down at the neck.
    const sway = Math.sin((beatN + beat) * Math.PI) * 0.05 * g + Math.sin(t * 0.6 + (bass ? 1 : 0)) * 0.025;
    this.turn('hip', Y, sway * 0.5 + (bass ? 0.08 : -0.08));
    this.turn('spine_01', Z, sway * 0.3);
    this.turn('spine_02', X, 0.07 + pulse * 0.04 * g);
    this.turn('neck', X, 0.1 + pulse * 0.14 * g);
    const glance = Math.max(0, Math.sin(t * 0.4 + (bass ? 2 : 0))) * 0.35;
    this.turn('head', X, 0.12 + glance * 0.25, this.qD.setFromAxisAngle(Y, glance));
    this.model.updateMatrixWorld(true);

    // Fretting hand slides to a new position with each chord change.
    const target = playing ? 0.22 + ((music.barIndex() * 0.37) % 1) * 0.45 : 0.3;
    this.fret += (target - this.fret) * Math.min(1, delta * 6);
    const neck = this.guitar!;
    const fretPt = this.toModel(neck.localToWorld(this.vA.set(0.12 + this.neckLen * this.fret, 0.0, -0.025)));
    this.reach('l', fretPt.clone(), new Vector3(0.75, 0.4, -0.3));

    // Picking hand: guitar strums down/up on 8ths; bass plucks on bass notes.
    let stroke: number;
    if (!playing) stroke = 0.01 * Math.sin(t * 2);
    else if (bass) stroke = 0.035 * Math.exp(-music.since('bass') * 10) - 0.01;
    else stroke = 0.045 * Math.sin((beatN + beat) * Math.PI * 2);
    const pick = this.toModel(neck.localToWorld(this.vB.set(-0.05, stroke, bass ? 0.05 : 0.07)));
    this.reach('r', pick.clone(), new Vector3(-0.7, 0.7, -0.5));

    this.curl('l', 0.85, 0.4);
    this.curl('r', bass ? 0.45 : 0.9, 0.5);
  }

  private updateDrums(): void {
    const t = this.t;
    const { playing, pulse, g } = this.groove();

    // Sit: lower the hips onto the stool, feet on the pedals.
    const hip = this.bones.get('hip')!;
    hip.bone.position.copy(hip.restPos);
    hip.bone.position.y -= (0.956 - 0.62) / this.parentScale(hip.bone);
    this.turn('spine_01', X, 0.12 + pulse * 0.05 * g);
    this.turn('spine_02', Z, Math.sin(t * 0.8) * 0.03);
    this.turn('neck', X, 0.05 + pulse * 0.16 * g);
    this.turn('head', X, -0.05);
    this.model.updateMatrixWorld(true);

    const kick = Math.exp(-music.since('kick') * 14);
    const kickPedal = KIT.kickPedal.clone().add(new Vector3(0, 0.07 * (1 - kick), 0));
    this.ik('upperleg_r', 'lowerleg_r', 'foot_r', kickPedal, new Vector3(-0.1, 0.8, 1.5));
    this.ik('upperleg_l', 'lowerleg_l', 'foot_l', KIT.hatPedal.clone(), new Vector3(0.1, 0.8, 1.5));

    // Sticks: right hand on the hi-hat, left hand on the snare. Each stick
    // lifts after a hit and comes down right on the next scheduled hit.
    const lift = (since: number, until: number): number => {
      const up = 1 - Math.exp(-since * 9);
      const down = Math.min(1, until / 0.12);
      return Math.min(up, down);
    };
    const hatH = playing ? lift(music.since('hat'), music.until('hat')) : 0.6;
    const snrH = playing ? lift(music.since('snare'), music.until('snare')) : 0.6;
    this.strike('r', KIT.hat, hatH, new Vector3(-0.8, 0.7, -0.3), 0);
    this.strike('l', KIT.snare, snrH, new Vector3(0.8, 0.7, -0.3), 1);
    this.curl('r', 0.95, 0.5);
    this.curl('l', 0.95, 0.5);
  }

  /** Hand and stick for one drum: the stick tip lands on `surface` when `height` is 0. */
  private strike(side: Side, surface: Vector3, height: number, pole: Vector3, stickIndex: number): void {
    const stickLen = 0.34;
    const lift = 0.04 + height * 0.2;
    const dir = new Vector3(side === 'r' ? 0.25 : -0.25, -0.35 - height * 0.4, 1).normalize();
    const tip = surface.clone().add(new Vector3(0, lift * 0.35, 0));
    const hand = tip.clone().addScaledVector(dir, -stickLen).add(new Vector3(0, lift, 0));
    this.reach(side, hand, pole);
    this.model.updateMatrixWorld(true);
    const stick = this.sticks[stickIndex];
    const grip = this.grip(side, new Vector3());
    this.root.worldToLocal(grip);
    stick.position.copy(grip);
    const tipLocal = tip.clone().applyMatrix4(this.model.matrix);
    stick.quaternion.setFromUnitVectors(Y, tipLocal.sub(grip).normalize());
  }

  /** Product of scales between a bone and the model (rigs often carry 0.01). */
  private parentScale(b: Object3D): number {
    let k = 1;
    let o: Object3D | null = b.parent;
    while (o && o !== this.model) {
      k *= o.scale.x;
      o = o.parent;
    }
    return k;
  }
}
