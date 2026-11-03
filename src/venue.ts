/**
 * A concert stage for Jam Along: deck and drum riser, aluminium truss with
 * moving-head lights, soft volumetric beams with light pools where they land,
 * a pixel LED screen, speaker stacks, guitar amps, floor monitors and a mic
 * stand for the singer.
 *
 * Everything is procedural (no downloads) and kept Quest-friendly: shared
 * materials, instancing for repeated parts, no shadows, no post-processing.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
} from '@iwsdk/core';

export const STAGE_Z = -4.0;
export const STAGE_TOP = 0.5;
export const STAGE_W = 7.2;
export const STAGE_D = 3.6;
export const STAGE_FRONT = STAGE_Z + STAGE_D / 2;
export const RISER_H = 0.32;
/** Where each band member stands (feet), facing the player. */
export const SPOTS = {
  singer: new Vector3(0, STAGE_TOP, STAGE_FRONT - 0.75),
  guitarist: new Vector3(2.05, STAGE_TOP, STAGE_Z + 0.15),
  bassist: new Vector3(-2.05, STAGE_TOP, STAGE_Z + 0.15),
  drummer: new Vector3(0, STAGE_TOP + RISER_H, STAGE_Z - 0.95),
};

// ---------------------------------------------------------------- textures

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Soft radial falloff, used for light pools and lamp lenses. */
function radialTexture(): CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Beam falloff: bright at the lamp, fading toward the floor and the edges. */
function beamTexture(): CanvasTexture {
  return canvasTexture(64, 256, (ctx) => {
    for (let y = 0; y < 256; y++) {
      // In ConeGeometry uv.y = 1 at the tip (the lamp) and 0 at the base.
      const along = y / 255; // 0 at the top of the canvas = tip
      const a = Math.pow(1 - along, 1.6) * 0.95 + 0.05;
      for (let x = 0; x < 64; x++) {
        const u = x / 63;
        // Brighter edges where the cone is seen side-on, like real haze.
        const edge = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(u * Math.PI * 2)), 0.6);
        ctx.fillStyle = `rgba(255,255,255,${(a * edge).toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

function grilleTexture(): CanvasTexture {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#111014';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#1c1a21';
    for (let y = 0; y < 256; y += 4) {
      for (let x = (y / 4) % 2 ? 2 : 0; x < 256; x += 4) ctx.fillRect(x, y, 2, 2);
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function speakerFaceTexture(): CanvasTexture {
  return canvasTexture(256, 512, (ctx) => {
    ctx.fillStyle = '#121116';
    ctx.fillRect(0, 0, 256, 512);
    const cone = (cx: number, cy: number, r: number): void => {
      const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#2c2a31');
      g.addColorStop(0.25, '#0b0a0d');
      g.addColorStop(0.85, '#1b1a1f');
      g.addColorStop(1, '#3a3840');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a4752';
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    cone(128, 140, 100);
    cone(128, 370, 100);
    ctx.fillStyle = '#2a2830';
    ctx.fillRect(98, 252, 60, 14);
  });
}

function ampFaceTexture(): CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#1a1714';
    ctx.fillRect(0, 0, 256, 256);
    // Woven grille cloth.
    for (let y = 18; y < 238; y += 3) {
      ctx.fillStyle = y % 6 ? '#2b2620' : '#221e19';
      ctx.fillRect(18, y, 220, 2);
    }
    ctx.strokeStyle = '#b9a575';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, 228, 228);
  });
}

// ---------------------------------------------------------------- materials

const M = {
  deck: new MeshStandardMaterial({ color: 0x141018, roughness: 0.42, metalness: 0.25 }),
  skirt: new MeshStandardMaterial({ color: 0x08070a, roughness: 0.95, metalness: 0 }),
  floor: new MeshStandardMaterial({ color: 0x060509, roughness: 0.62, metalness: 0.1, envMapIntensity: 0.35 }),
  carpet: new MeshStandardMaterial({ color: 0x2a1220, roughness: 1, metalness: 0 }),
  truss: new MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.35, metalness: 0.9 }),
  fixture: new MeshStandardMaterial({ color: 0x18181c, roughness: 0.5, metalness: 0.6 }),
  cabinet: new MeshStandardMaterial({ color: 0x141317, roughness: 0.75, metalness: 0.05 }),
  chrome: new MeshStandardMaterial({ color: 0xd8dbe2, roughness: 0.2, metalness: 1 }),
  black: new MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.6, metalness: 0.3 }),
  gold: new MeshStandardMaterial({ color: 0xc9a85c, roughness: 0.35, metalness: 0.9 }),
};

function glow(color: Color | number, opacity: number, map?: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------- truss

const TRUSS = 0.3; // box truss width
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const up = new Vector3(0, 1, 0);

/** Collects cylinder "tubes" and builds them as one InstancedMesh. */
class TubeBatch {
  private mats: Matrix4[] = [];
  tube(a: Vector3, b: Vector3, r: number): void {
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length();
    tmpQ.setFromUnitVectors(up, dir.normalize());
    const m = new Matrix4().compose(
      new Vector3().addVectors(a, b).multiplyScalar(0.5),
      tmpQ,
      new Vector3(r, len, r),
    );
    this.mats.push(m);
  }
  build(material: MeshStandardMaterial): InstancedMesh {
    const mesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6, 1), material, this.mats.length);
    this.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

/** A straight box-truss run from a to b (4 chords plus zig-zag lacing). */
function trussRun(batch: TubeBatch, a: Vector3, b: Vector3): void {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const side = Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(dir, side).normalize().multiplyScalar(TRUSS / 2);
  const v = new Vector3().crossVectors(dir, u).normalize().multiplyScalar(TRUSS / 2);
  const corners = [
    new Vector3().add(u).add(v),
    new Vector3().add(u).sub(v),
    new Vector3().sub(u).sub(v),
    new Vector3().sub(u).add(v),
  ];
  for (const c of corners) batch.tube(new Vector3().addVectors(a, c), new Vector3().addVectors(b, c), 0.024);
  const steps = Math.max(1, Math.round(len / TRUSS));
  for (let s = 0; s < steps; s++) {
    const p0 = new Vector3().copy(a).addScaledVector(dir, (s / steps) * len);
    const p1 = new Vector3().copy(a).addScaledVector(dir, ((s + 1) / steps) * len);
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k];
      const c1 = corners[(k + 1) % 4];
      // Diagonal on each face, alternating direction.
      const from = s % 2 ? c0 : c1;
      const to = s % 2 ? c1 : c0;
      batch.tube(new Vector3().addVectors(p0, from), new Vector3().addVectors(p1, to), 0.011);
    }
  }
}

// ---------------------------------------------------------------- moving heads

export interface MovingHead {
  /** Pans around Y. */
  yoke: Group;
  /** Tilts around X; the beam points down its -Y. */
  head: Group;
  beam: Mesh<ConeGeometry, MeshBasicMaterial>;
  lens: Mesh<CircleGeometry, MeshBasicMaterial>;
  pool: Mesh<CircleGeometry, MeshBasicMaterial>;
  base: Vector3;
  phase: number;
  /** Which way this light points when idle (stage position it looks at). */
  aim: Vector3;
}

const BEAM_LEN = 6.5;

function movingHead(beamTex: Texture, poolTex: Texture, phase: number, aim: Vector3): MovingHead {
  const yoke = new Group();
  const base = new Mesh(new BoxGeometry(0.26, 0.1, 0.26), M.fixture);
  base.position.y = 0.05;
  yoke.add(base);
  const armGeo = new BoxGeometry(0.04, 0.24, 0.12);
  for (const x of [-0.13, 0.13]) {
    const arm = new Mesh(armGeo, M.fixture);
    arm.position.set(x, -0.1, 0);
    yoke.add(arm);
  }
  const head = new Group();
  head.position.y = -0.2;
  yoke.add(head);
  const body = new Mesh(new CylinderGeometry(0.1, 0.12, 0.26, 16), M.fixture);
  head.add(body);
  const lens = new Mesh(new CircleGeometry(0.085, 20), glow(0xffffff, 0.9));
  lens.rotation.x = Math.PI / 2;
  lens.position.y = -0.131;
  head.add(lens);
  // Open cone with its tip at the lens, pointing down -Y.
  const coneGeo = new ConeGeometry(0.75, BEAM_LEN, 28, 1, true);
  coneGeo.translate(0, -BEAM_LEN / 2, 0);
  const beam = new Mesh(coneGeo, glow(0xffffff, 0.12, beamTex));
  beam.position.y = -0.13;
  beam.renderOrder = 2;
  head.add(beam);
  const pool = new Mesh(new CircleGeometry(0.75, 32), glow(0xffffff, 0.25, poolTex));
  pool.rotation.x = -Math.PI / 2;
  pool.renderOrder = 1;
  return { yoke, head, beam, lens, pool, base: new Vector3(), phase, aim };
}

// ---------------------------------------------------------------- props

function speakerStack(faceTex: Texture): Group {
  const g = new Group();
  const sub = new Mesh(new BoxGeometry(0.9, 0.62, 0.7), M.cabinet);
  sub.position.y = 0.31;
  g.add(sub);
  const subFace = new Mesh(new PlaneGeometry(0.84, 0.56), new MeshStandardMaterial({ map: grilleTex, roughness: 0.9 }));
  subFace.position.set(0, 0.31, 0.351);
  g.add(subFace);
  for (let i = 0; i < 2; i++) {
    const top = new Mesh(new BoxGeometry(0.55, 1.0, 0.5), M.cabinet);
    top.position.y = 0.62 + 0.5 + i * 1.02;
    g.add(top);
    const face = new Mesh(new PlaneGeometry(0.5, 0.95), new MeshStandardMaterial({ map: faceTex, roughness: 0.85 }));
    face.position.set(0, top.position.y, 0.251);
    g.add(face);
  }
  return g;
}

function ampStack(faceTex: Texture): Group {
  const g = new Group();
  const cab = new Mesh(new BoxGeometry(0.76, 0.76, 0.36), M.black);
  cab.position.y = 0.38;
  g.add(cab);
  const face = new Mesh(new PlaneGeometry(0.72, 0.72), new MeshStandardMaterial({ map: faceTex, roughness: 0.9 }));
  face.position.set(0, 0.38, 0.181);
  g.add(face);
  const head = new Mesh(new BoxGeometry(0.76, 0.26, 0.3), M.black);
  head.position.set(0, 0.89, -0.02);
  g.add(head);
  const panel = new Mesh(new BoxGeometry(0.66, 0.08, 0.01), M.gold);
  panel.position.set(0, 0.89, 0.135);
  g.add(panel);
  const knobGeo = new CylinderGeometry(0.014, 0.014, 0.02, 10);
  knobGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const k = new Mesh(knobGeo, M.black);
    k.position.set(-0.28 + i * 0.08, 0.89, 0.145);
    g.add(k);
  }
  const led = new Mesh(new SphereGeometry(0.008, 8, 6), glow(0xff3030, 1));
  led.position.set(0.31, 0.93, 0.145);
  g.add(led);
  return g;
}

function wedgeMonitor(): Group {
  const g = new Group();
  const body = new Mesh(new BoxGeometry(0.62, 0.3, 0.42), M.cabinet);
  body.position.y = 0.17;
  body.rotation.x = -0.55; // sloped face toward the band
  g.add(body);
  const face = new Mesh(new PlaneGeometry(0.56, 0.24), new MeshStandardMaterial({ map: grilleTex, roughness: 0.9 }));
  face.position.set(0, 0.17, 0);
  face.rotation.x = -0.55;
  face.translateZ(-0.212);
  face.rotateY(Math.PI);
  g.add(face);
  return g;
}

/** Mic stand; returns the group and the mic's world-local tip for the singer. */
export function micStand(): Group {
  const g = new Group();
  g.name = 'Mic Stand';
  for (let i = 0; i < 3; i++) {
    const leg = new Mesh(new CylinderGeometry(0.008, 0.008, 0.3, 6), M.black);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12);
    leg.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
    g.add(leg);
  }
  const pole = new Mesh(new CylinderGeometry(0.009, 0.011, 1.45, 8), M.chrome);
  pole.position.y = 0.8;
  g.add(pole);
  const clip = new Mesh(new CylinderGeometry(0.012, 0.012, 0.06, 8), M.black);
  clip.position.set(0, 1.54, 0.04);
  clip.rotation.x = Math.PI / 2.4;
  g.add(clip);
  const mic = new Mesh(new CylinderGeometry(0.016, 0.011, 0.15, 12), M.black);
  mic.position.set(0, 1.56, 0.1);
  mic.rotation.x = Math.PI / 2.6;
  g.add(mic);
  const grille = new Mesh(new SphereGeometry(0.024, 12, 10), M.chrome);
  grille.position.set(0, 1.585, 0.175);
  g.add(grille);
  return g;
}

let grilleTex: Texture;

// ---------------------------------------------------------------- LED screen

export interface LedScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  w: number;
  h: number;
}

const LED_W = 160;
const LED_H = 80;

function ledScreen(width: number, height: number): { group: Group; screen: LedScreen } {
  const group = new Group();
  const canvas = document.createElement('canvas');
  canvas.width = LED_W;
  canvas.height = LED_H;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  const panel = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  group.add(panel);
  // Pixel grid: thin dark gaps between LEDs, like a real video wall.
  const mask = canvasTexture(8, 8, (c) => {
    c.clearRect(0, 0, 8, 8);
    c.fillStyle = 'rgba(0,0,0,0.85)';
    c.fillRect(0, 7, 8, 1);
    c.fillRect(7, 0, 1, 8);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, 8, 1);
    c.fillRect(0, 0, 1, 8);
  });
  mask.wrapS = mask.wrapT = RepeatWrapping;
  mask.repeat.set(LED_W, LED_H);
  mask.magFilter = NearestFilter;
  const grid = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: mask, transparent: true, depthWrite: false, toneMapped: false }),
  );
  grid.position.z = 0.004;
  group.add(grid);
  // Frame
  const frame = new Mesh(new BoxGeometry(width + 0.12, height + 0.12, 0.08), M.black);
  frame.position.z = -0.045;
  group.add(frame);
  return { group, screen: { canvas, ctx, texture, w: LED_W, h: LED_H } };
}

// ---------------------------------------------------------------- room

export interface Room {
  root: Group;
  floorRing: Mesh<RingGeometry, MeshBasicMaterial>;
  stageEdge: Mesh<BoxGeometry, MeshBasicMaterial>;
  heads: MovingHead[];
  screen: LedScreen;
  /** Soft colour wash on the stage floor that pulses with the music. */
  wash: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Warm accent lamps on top of the speaker stacks. */
  ampLeds: MeshBasicMaterial[];
}

export function buildRoom(): Room {
  const root = new Group();
  root.name = 'Venue';
  grilleTex = grilleTexture();
  const beamTex = beamTexture();
  const poolTex = radialTexture();

  // Polished venue floor.
  const floor = new Mesh(new CircleGeometry(16, 64), M.floor);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // A glowing ring around the player that pulses with the kick drum.
  const floorRing = new Mesh(new RingGeometry(0.9, 0.95, 64), glow(0xff4fa0, 0.45));
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = 0.005;
  root.add(floorRing);

  // Stage deck with a black cloth skirt and a lit front edge.
  const deck = new Mesh(new BoxGeometry(STAGE_W, 0.06, STAGE_D), M.deck);
  deck.position.set(0, STAGE_TOP - 0.03, STAGE_Z);
  root.add(deck);
  const skirt = new Mesh(new BoxGeometry(STAGE_W, STAGE_TOP - 0.06, STAGE_D - 0.04), M.skirt);
  skirt.position.set(0, (STAGE_TOP - 0.06) / 2, STAGE_Z);
  root.add(skirt);
  const stageEdge = new Mesh(new BoxGeometry(STAGE_W + 0.02, 0.022, 0.022), glow(0xff4fa0, 0.9));
  stageEdge.position.set(0, STAGE_TOP + 0.002, STAGE_FRONT + 0.01);
  root.add(stageEdge);

  // Drum riser with carpet.
  const riser = new Mesh(new BoxGeometry(2.6, RISER_H, 1.9), M.skirt);
  riser.position.set(0, STAGE_TOP + RISER_H / 2, STAGE_Z - 0.85);
  root.add(riser);
  const rug = new Mesh(new BoxGeometry(2.5, 0.01, 1.8), M.carpet);
  rug.position.set(0, STAGE_TOP + RISER_H + 0.005, STAGE_Z - 0.85);
  root.add(rug);

  // Colour wash on the stage floor (cheap stand-in for bounced light).
  const wash = new Mesh(new PlaneGeometry(STAGE_W * 0.95, STAGE_D * 0.9), glow(0xffffff, 0.12, poolTex));
  wash.rotation.x = -Math.PI / 2;
  wash.position.set(0, STAGE_TOP + 0.004, STAGE_Z);
  wash.renderOrder = 1;
  root.add(wash);

  // Truss: two towers, a front span and a back span.
  const tubes = new TubeBatch();
  const front = STAGE_FRONT - 0.35;
  const back = STAGE_Z - STAGE_D / 2 + 0.2;
  const xT = STAGE_W / 2 + 0.25;
  const yTop = 4.3;
  for (const x of [-xT, xT]) {
    trussRun(tubes, new Vector3(x, 0, front), new Vector3(x, yTop, front));
    trussRun(tubes, new Vector3(x, 0, back), new Vector3(x, yTop, back));
    trussRun(tubes, new Vector3(x, yTop, front), new Vector3(x, yTop, back));
  }
  trussRun(tubes, new Vector3(-xT, yTop, front), new Vector3(xT, yTop, front));
  trussRun(tubes, new Vector3(-xT, yTop, back), new Vector3(xT, yTop, back));
  root.add(tubes.build(M.truss));
  for (const x of [-xT, xT]) {
    for (const z of [front, back]) {
      const plate = new Mesh(new BoxGeometry(0.6, 0.03, 0.6), M.black);
      plate.position.set(x, 0.015, z);
      root.add(plate);
    }
  }

  // Moving heads hanging from the front and back spans.
  const heads: MovingHead[] = [];
  const frontXs = [-2.7, -1.35, 0, 1.35, 2.7];
  frontXs.forEach((x, i) => {
    const aim = new Vector3(x * 0.55, STAGE_TOP, STAGE_Z + 0.3);
    const h = movingHead(beamTex, poolTex, i * 1.3, aim);
    h.yoke.position.set(x, yTop - TRUSS / 2 - 0.05, front);
    h.base.copy(h.yoke.position);
    root.add(h.yoke);
    root.add(h.pool);
    heads.push(h);
  });
  const backXs = [-2.0, 2.0];
  backXs.forEach((x, i) => {
    const aim = new Vector3(x * 1.4, 9, STAGE_Z + 0.5); // fan up into the haze above the stage
    const h = movingHead(beamTex, poolTex, 10 + i * 2.1, aim);
    h.yoke.position.set(x, yTop - TRUSS / 2 - 0.05, back);
    h.base.copy(h.yoke.position);
    h.pool.visible = false;
    root.add(h.yoke);
    heads.push(h);
  });

  // LED screen behind the band.
  const { group: led, screen } = ledScreen(5.6, 2.8);
  led.position.set(0, STAGE_TOP + 0.55 + 1.4 + RISER_H, back - 0.05);
  root.add(led);

  // Speaker stacks on the floor, either side of the stage.
  const faceTex = speakerFaceTexture();
  const ampLeds: MeshBasicMaterial[] = [];
  for (const side of [-1, 1]) {
    const stack = speakerStack(faceTex);
    stack.position.set(side * (STAGE_W / 2 + 0.95), 0, STAGE_FRONT - 0.2);
    stack.rotation.y = -side * 0.22;
    root.add(stack);
    const lamp = glow(0xffb070, 0.6);
    const strip = new Mesh(new BoxGeometry(0.5, 0.012, 0.012), lamp);
    strip.position.set(side * (STAGE_W / 2 + 0.95), 2.68, STAGE_FRONT - 0.02);
    root.add(strip);
    ampLeds.push(lamp);
  }

  // Guitar amps behind the guitarist and bassist.
  const ampTex = ampFaceTexture();
  for (const side of [-1, 1]) {
    const amp = ampStack(ampTex);
    amp.position.set(side * 2.55, STAGE_TOP, STAGE_Z - 0.75);
    amp.rotation.y = -side * 0.25;
    root.add(amp);
  }

  // Floor monitors facing the band.
  for (const [x, rot] of [[-2.05, 0.15], [0.55, 0], [-0.55, 0], [2.05, -0.15]] as const) {
    const w = wedgeMonitor();
    w.position.set(x, STAGE_TOP, STAGE_FRONT - 0.25);
    w.rotation.y = rot;
    root.add(w);
  }

  // The singer's mic stand.
  const mic = micStand();
  mic.position.copy(SPOTS.singer).add(new Vector3(0, 0, 0.35));
  mic.rotation.y = Math.PI; // boom faces the singer
  root.add(mic);

  return { root, floorRing, stageEdge, heads, screen, wash, ampLeds };
}

// ---------------------------------------------------------------- per-frame helpers

const tmpDir = new Vector3();
const tmpPos = new Vector3();
const tmpObj = new Object3D();

/**
 * Point a moving head at a world-space target (pan the yoke around Y, tilt
 * the head around X), and drop its light pool where the beam meets the stage.
 */
export function aimHead(h: MovingHead, target: Vector3): void {
  tmpDir.subVectors(target, h.base);
  const pan = Math.atan2(tmpDir.x, tmpDir.z);
  const flat = Math.hypot(tmpDir.x, tmpDir.z);
  const tilt = Math.atan2(flat, -tmpDir.y); // 0 = straight down
  h.yoke.rotation.set(0, pan, 0);
  h.head.rotation.set(tilt, 0, 0);
  if (h.pool.visible && tmpDir.y < -0.1) {
    const k = (STAGE_TOP + 0.006 - h.base.y) / tmpDir.y;
    tmpPos.copy(h.base).addScaledVector(tmpDir, k);
    h.pool.position.copy(tmpPos);
    // Pools stretch when the beam hits at an angle.
    const slant = Math.min(2.2, 1 / Math.max(0.35, Math.cos(tilt)));
    tmpObj.rotation.set(-Math.PI / 2, 0, -pan);
    h.pool.rotation.copy(tmpObj.rotation);
    h.pool.scale.set(0.8, 0.8 * slant, 1);
  }
}

