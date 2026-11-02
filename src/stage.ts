/**
 * Procedural geometry for Jam Along: the room, the stage, the band and the
 * player's keyboard. Pure Three.js, no ECS, so the systems decide when to
 * create entities from these objects.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

// ---------------------------------------------------------------- materials

export function glowMaterial(color: Color | number, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function solid(color: number, emissive = 0x000000, emissiveIntensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.15,
    emissive,
    emissiveIntensity,
  });
}

// ---------------------------------------------------------------- room

export interface Room {
  root: Group;
  floorRing: Mesh<RingGeometry, MeshBasicMaterial>;
  stageEdge: Mesh<BoxGeometry, MeshBasicMaterial>;
  beams: Array<Mesh<ConeGeometry, MeshBasicMaterial>>;
  wall: InstancedMesh;
  wallBars: number;
}

export const STAGE_Z = -4.0;
export const STAGE_TOP = 0.3;

export function buildRoom(): Room {
  const root = new Group();
  root.name = 'Room';

  const floor = new Mesh(new CircleGeometry(14, 64), solid(0x0b0812));
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // A glowing ring around the player that pulses with the kick drum.
  const floorRing = new Mesh(new RingGeometry(0.9, 0.96, 64), glowMaterial(0xff4fa0, 0.5));
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = 0.005;
  root.add(floorRing);

  const stage = new Mesh(new BoxGeometry(6, STAGE_TOP, 2.8), solid(0x17111f));
  stage.position.set(0, STAGE_TOP / 2, STAGE_Z);
  root.add(stage);

  const stageEdge = new Mesh(new BoxGeometry(6.02, 0.025, 0.025), glowMaterial(0xff4fa0, 0.9));
  stageEdge.position.set(0, STAGE_TOP, STAGE_Z + 1.41);
  root.add(stageEdge);

  // Light beams sweeping down onto the band.
  const beams: Room['beams'] = [];
  const beamGeo = new ConeGeometry(0.75, 4.2, 24, 1, true);
  beamGeo.translate(0, -2.1, 0); // pivot at the tip, so it swings like a spotlight
  for (let i = 0; i < 4; i++) {
    const beam = new Mesh(beamGeo, glowMaterial(0xffffff, 0.06));
    beam.position.set(-2.4 + i * 1.6, 4.6, STAGE_Z - 0.4);
    root.add(beam);
    beams.push(beam);
  }

  // LED wall: one bar per frequency band of the music.
  const wallBars = 28;
  const wall = new InstancedMesh(
    new BoxGeometry(0.17, 1, 0.04),
    new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    wallBars,
  );
  wall.position.set(0, STAGE_TOP, STAGE_Z - 1.5);
  wall.frustumCulled = false;
  root.add(wall);

  const wallBack = new Mesh(new PlaneGeometry(6.4, 3.6), solid(0x0a0710));
  wallBack.position.set(0, STAGE_TOP + 1.8, STAGE_Z - 1.55);
  root.add(wallBack);

  return { root, floorRing, stageEdge, beams, wall, wallBars };
}

// ---------------------------------------------------------------- band

export interface Musician {
  root: Group;
  head: Mesh;
  torso: Group;
  /** Shoulder pivots; rotate around x to swing an arm. */
  armL: Group;
  armR: Group;
  /** Instrument parts that bounce when they are hit. */
  hitParts: Mesh[];
  glow: MeshStandardMaterial;
}

function limb(length: number, radius: number, mat: MeshStandardMaterial): Group {
  const pivot = new Group();
  const m = new Mesh(new CapsuleGeometry(radius, length, 4, 10), mat);
  m.position.y = -length / 2;
  pivot.add(m);
  return pivot;
}

function figure(seated: boolean): Musician {
  const glow = solid(0x120e1a, 0xff4fa0, 0.45);
  const skin = solid(0x2a2236, 0xff4fa0, 0.25);
  const root = new Group();
  const hip = seated ? 0.5 : 0.85;

  if (!seated) {
    for (const x of [-0.1, 0.1]) {
      const leg = limb(0.62, 0.065, glow);
      leg.position.set(x, hip, 0);
      root.add(leg);
    }
  } else {
    const stool = new Mesh(new CylinderGeometry(0.2, 0.2, 0.06, 20), solid(0x221a2c));
    stool.position.y = hip - 0.05;
    root.add(stool);
    for (const x of [-0.1, 0.1]) {
      const thigh = limb(0.32, 0.065, glow);
      thigh.position.set(x, hip, 0);
      thigh.rotation.x = Math.PI / 2;
      root.add(thigh);
    }
  }

  const torso = new Group();
  torso.position.y = hip;
  root.add(torso);
  const body = new Mesh(new CapsuleGeometry(0.16, 0.38, 6, 14), glow);
  body.position.y = 0.36;
  torso.add(body);

  const head = new Mesh(new SphereGeometry(0.125, 20, 14), skin);
  head.position.y = 0.82;
  torso.add(head);

  const armL = limb(0.5, 0.05, glow);
  armL.position.set(-0.23, 0.64, 0);
  torso.add(armL);
  const armR = limb(0.5, 0.05, glow);
  armR.position.set(0.23, 0.64, 0);
  torso.add(armR);

  return { root, head, torso, armL, armR, hitParts: [], glow };
}

export function buildDrummer(): Musician {
  const m = figure(true);
  m.armL.rotation.set(-0.9, 0, 0.25);
  m.armR.rotation.set(-0.9, 0, -0.25);
  const shell = solid(0x2b2140, 0x7a5cff, 0.4);
  const metal = solid(0xb59a4a, 0x553c00, 0.3);

  const kick = new Mesh(new CylinderGeometry(0.26, 0.26, 0.3, 28), shell);
  kick.rotation.x = Math.PI / 2;
  kick.position.set(0, 0.28, 0.55);
  const snare = new Mesh(new CylinderGeometry(0.15, 0.15, 0.1, 24), shell);
  snare.position.set(-0.28, 0.72, 0.42);
  const tom = new Mesh(new CylinderGeometry(0.13, 0.13, 0.12, 24), shell);
  tom.position.set(0.12, 0.8, 0.5);
  const hat = new Mesh(new CylinderGeometry(0.17, 0.17, 0.012, 24), metal);
  hat.position.set(-0.55, 0.95, 0.35);
  const crash = new Mesh(new CylinderGeometry(0.22, 0.22, 0.012, 24), metal);
  crash.position.set(0.5, 1.25, 0.4);
  crash.rotation.z = -0.25;
  m.root.add(kick, snare, tom, hat, crash);
  m.hitParts.push(kick, snare, hat);
  return m;
}

function stringInstrument(neckLength: number, bodySize: number, color: number): Group {
  const g = new Group();
  const mat = solid(color, color, 0.35);
  const body = new Mesh(new BoxGeometry(bodySize, bodySize * 1.15, 0.06), mat);
  const neck = new Mesh(new BoxGeometry(0.05, neckLength, 0.03), solid(0x3a2a1a));
  neck.position.set(0, bodySize * 0.55 + neckLength / 2, 0);
  g.add(body, neck);
  // Worn across the body, neck pointing up and to the player's left.
  g.rotation.set(0, 0, 1.15);
  return g;
}

export function buildBassist(): Musician {
  const m = figure(false);
  const bass = stringInstrument(0.85, 0.3, 0x3fd0ff);
  bass.position.set(0.05, 0.4, 0.2);
  m.torso.add(bass);
  m.armL.rotation.set(-0.6, 0, 1.0);
  m.armR.rotation.set(-0.5, 0, -0.2);
  m.hitParts.push(bass.children[0] as Mesh);
  return m;
}

export function buildGuitarist(): Musician {
  const m = figure(false);
  const guitar = stringInstrument(0.6, 0.3, 0xffb23f);
  guitar.position.set(0.05, 0.4, 0.2);
  m.torso.add(guitar);
  m.armL.rotation.set(-0.6, 0, 1.0);
  m.armR.rotation.set(-0.5, 0, -0.2);
  m.hitParts.push(guitar.children[0] as Mesh);
  return m;
}

// ---------------------------------------------------------------- keyboard

export const KEY_WIDTH = 0.058;
export const KEY_PITCH = 0.065;
export const KEY_DEPTH = 0.17;
export const KEY_HEIGHT = 0.022;

export interface KeyVisual {
  /** Static frame used for touch tests. */
  frame: Group;
  /** The moving key cap. */
  cap: Mesh<BoxGeometry, MeshStandardMaterial>;
  color: Color;
}

export function keyHue(index: number, count: number): number {
  return 0.92 - (index / (count - 1)) * 0.62;
}

export function buildKeyboardBase(width: number): Group {
  const g = new Group();
  g.name = 'Keyboard';
  const base = new Mesh(new BoxGeometry(width, 0.035, KEY_DEPTH + 0.08), solid(0x15101d));
  base.position.set(0, -0.03, -0.02);
  g.add(base);
  const edge = new Mesh(new BoxGeometry(width, 0.006, 0.006), glowMaterial(0x7a5cff, 0.9));
  edge.position.set(0, -0.012, KEY_DEPTH / 2 + 0.018);
  g.add(edge);
  const back = new Mesh(new BoxGeometry(width, 0.05, 0.05), solid(0x1d1626));
  back.position.set(0, 0.005, -KEY_DEPTH / 2 - 0.045);
  g.add(back);
  return g;
}

export function buildKey(index: number, count: number): KeyVisual {
  const frame = new Group();
  const color = new Color().setHSL(keyHue(index, count), 0.85, 0.58);
  const mat = new MeshStandardMaterial({
    color: new Color().setHSL(keyHue(index, count), 0.35, 0.22),
    roughness: 0.35,
    metalness: 0.05,
    emissive: color,
    emissiveIntensity: 0.25,
  });
  const cap = new Mesh(new BoxGeometry(KEY_WIDTH, KEY_HEIGHT, KEY_DEPTH), mat);
  frame.add(cap);
  return { frame, cap, color };
}

// ---------------------------------------------------------------- drum pads

export const PAD_HEIGHT = 0.026;

export interface PadVisual {
  /** Static frame used for touch tests. */
  frame: Group;
  /** The moving drum head. */
  cap: Mesh<CylinderGeometry, MeshStandardMaterial>;
  /** Glow ring that ripples outward on each hit. */
  ripple: Mesh<RingGeometry, MeshBasicMaterial>;
  color: Color;
  radius: number;
}

export function buildPadBase(width: number, depth: number): Group {
  const g = new Group();
  g.name = 'Drum Pads';
  const base = new Mesh(new BoxGeometry(width, 0.035, depth), solid(0x15101d));
  base.position.set(0, -0.03, -0.01);
  g.add(base);
  const edge = new Mesh(new BoxGeometry(width, 0.006, 0.006), glowMaterial(0xff4fa0, 0.9));
  edge.position.set(0, -0.012, depth / 2 - 0.006);
  g.add(edge);
  return g;
}

export function buildPad(name: string, radius: number, hue: number): PadVisual {
  const frame = new Group();
  const color = new Color().setHSL(hue, 0.85, 0.58);

  const rim = new Mesh(
    new CylinderGeometry(radius + 0.008, radius + 0.008, PAD_HEIGHT * 0.8, 40),
    solid(0x241b31, color.getHex(), 0.15),
  );
  rim.position.y = -PAD_HEIGHT * 0.25;
  frame.add(rim);

  const cap = new Mesh(
    new CylinderGeometry(radius, radius, PAD_HEIGHT, 40),
    new MeshStandardMaterial({
      color: new Color().setHSL(hue, 0.35, 0.2),
      roughness: 0.45,
      emissive: color,
      emissiveIntensity: 0.3,
    }),
  );
  frame.add(cap);

  // Name printed on the drum head.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 54px system-ui, sans-serif';
    ctx.fillText(name.toUpperCase(), 128, 132, 210);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const label = new Mesh(
    new CircleGeometry(radius * 0.95, 40),
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.y = PAD_HEIGHT / 2 + 0.001;
  cap.add(label);

  const ripple = new Mesh(new RingGeometry(radius * 0.92, radius, 48), glowMaterial(color, 0));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.y = PAD_HEIGHT / 2 + 0.002;
  frame.add(ripple);

  return { frame, cap, ripple, color, radius };
}

// ---------------------------------------------------------------- particles

export function buildSpark(): Mesh<SphereGeometry, MeshBasicMaterial> {
  const m = new Mesh(new SphereGeometry(0.018, 10, 8), glowMaterial(0xffffff, 0));
  m.visible = false;
  return m;
}
