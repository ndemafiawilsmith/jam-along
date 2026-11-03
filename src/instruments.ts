/**
 * Procedural instruments for the band: electric guitar, bass, and a drum kit.
 * Origins are chosen so they are easy to attach: guitars at the body's centre
 * with the neck pointing along +X, the drum kit at the drummer's stool.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ExtrudeGeometry,
  TorusGeometry,
} from '@iwsdk/core';

export type InstrumentKind = 'guitar' | 'bass' | 'drums';

const chrome = new MeshStandardMaterial({ color: 0xdfe2e8, roughness: 0.18, metalness: 1 });
const black = new MeshStandardMaterial({ color: 0x111114, roughness: 0.45, metalness: 0.3 });
const rosewood = new MeshStandardMaterial({ color: 0x3b2316, roughness: 0.6 });
const maple = new MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.5 });
const brass = new MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.28, metalness: 0.95 });
const drumHead = new MeshStandardMaterial({ color: 0xece6da, roughness: 0.7 });

function bodyShape(scale: number, horns: number): Shape {
  // Offset double-cutaway body outline (rough "S-type" silhouette), in metres.
  const s = new Shape();
  const k = scale;
  s.moveTo(-0.2 * k, 0);
  s.bezierCurveTo(-0.22 * k, 0.13 * k, -0.08 * k, 0.17 * k, 0.0, 0.12 * k);
  s.bezierCurveTo(0.05 * k, 0.1 * k, 0.1 * k, 0.12 * k, 0.17 * k * horns, 0.16 * k);
  s.bezierCurveTo(0.12 * k, 0.06 * k, 0.12 * k, -0.06 * k, 0.15 * k * horns, -0.12 * k);
  s.bezierCurveTo(0.08 * k, -0.11 * k, 0.04 * k, -0.08 * k, 0.0, -0.11 * k);
  s.bezierCurveTo(-0.08 * k, -0.17 * k, -0.22 * k, -0.13 * k, -0.2 * k, 0);
  return s;
}

function guitar(bass: boolean, color: number): Group {
  const g = new Group();
  g.name = bass ? 'Bass Guitar' : 'Guitar';
  const finish = new MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.15 });
  const scale = bass ? 1.12 : 1;
  const body = new Mesh(
    new ExtrudeGeometry(bodyShape(scale, bass ? 1.15 : 1), { depth: 0.042, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 18 }),
    finish,
  );
  body.position.z = -0.021;
  g.add(body);
  const guard = new Mesh(new BoxGeometry(0.14 * scale, 0.1 * scale, 0.003), new MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }));
  guard.position.set(-0.03, -0.02, 0.028);
  g.add(guard);
  const neckLen = bass ? 0.86 : 0.62;
  const neck = new Mesh(new BoxGeometry(neckLen, 0.045, 0.022), maple);
  neck.position.set(0.12 + neckLen / 2, 0.01, 0.01);
  g.add(neck);
  const board = new Mesh(new BoxGeometry(neckLen, 0.047, 0.006), rosewood);
  board.position.set(0.12 + neckLen / 2, 0.01, 0.024);
  g.add(board);
  const head = new Mesh(new BoxGeometry(0.17, 0.07, 0.016), black);
  head.position.set(0.12 + neckLen + 0.08, 0.02, 0.008);
  g.add(head);
  // Strings
  const strings = bass ? 4 : 6;
  const stringGeo = new CylinderGeometry(0.0008, 0.0008, neckLen + 0.26, 4);
  stringGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < strings; i++) {
    const st = new Mesh(stringGeo, chrome);
    st.position.set(0.12 + neckLen / 2 - 0.1, 0.01 + (i - (strings - 1) / 2) * 0.007, 0.029);
    g.add(st);
  }
  // Pickups and bridge
  for (const x of bass ? [-0.06, 0.02] : [-0.1, -0.04, 0.02]) {
    const p = new Mesh(new BoxGeometry(0.018, 0.07, 0.006), black);
    p.position.set(x, 0.01, 0.03);
    g.add(p);
  }
  const bridge = new Mesh(new BoxGeometry(0.03, 0.06, 0.01), chrome);
  bridge.position.set(-0.15, 0.01, 0.028);
  g.add(bridge);
  return g;
}

function shell(radius: number, depth: number, color: MeshStandardMaterial): Group {
  const g = new Group();
  const s = new Mesh(new CylinderGeometry(radius, radius, depth, 28, 1, true), color);
  g.add(s);
  for (const y of [-depth / 2, depth / 2]) {
    const rim = new Mesh(new TorusGeometry(radius, 0.008, 6, 28), chrome);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
    const head = new Mesh(new CylinderGeometry(radius * 0.98, radius * 0.98, 0.002, 28), drumHead);
    head.position.y = y;
    g.add(head);
  }
  return g;
}

function cymbal(radius: number, height: number): Group {
  const g = new Group();
  const stand = new Mesh(new CylinderGeometry(0.008, 0.01, height, 6), chrome);
  stand.position.y = height / 2;
  g.add(stand);
  const c = new Mesh(new CylinderGeometry(radius, 0.01, 0.012, 28), brass);
  c.position.y = height;
  c.rotation.z = 0.12;
  g.add(c);
  return g;
}

/** A five-piece kit around a stool at the origin, facing +Z (toward the player). */
function drumKit(): Group {
  const g = new Group();
  g.name = 'Drum Kit';
  const wrap = new MeshStandardMaterial({ color: 0x7a1530, roughness: 0.25, metalness: 0.4 });
  const stool = new Mesh(new CylinderGeometry(0.17, 0.17, 0.07, 20), black);
  stool.position.y = 0.5;
  g.add(stool);
  const stoolLeg = new Mesh(new CylinderGeometry(0.02, 0.03, 0.47, 8), chrome);
  stoolLeg.position.y = 0.235;
  g.add(stoolLeg);
  const kick = shell(0.27, 0.42, wrap);
  kick.rotation.x = Math.PI / 2;
  kick.position.set(0, 0.28, 0.62);
  g.add(kick);
  const snare = shell(0.17, 0.13, wrap);
  snare.position.set(-0.24, 0.62, 0.42);
  snare.rotation.x = 0.12;
  g.add(snare);
  const tom1 = shell(0.13, 0.2, wrap);
  tom1.position.set(-0.1, 0.83, 0.6);
  tom1.rotation.x = 0.35;
  g.add(tom1);
  const tom2 = shell(0.15, 0.22, wrap);
  tom2.position.set(0.17, 0.83, 0.6);
  tom2.rotation.x = 0.35;
  g.add(tom2);
  const floorTom = shell(0.2, 0.36, wrap);
  floorTom.position.set(0.4, 0.42, 0.32);
  g.add(floorTom);
  const hat = cymbal(0.17, 0.82);
  hat.position.set(-0.5, 0, 0.38);
  g.add(hat);
  const crash = cymbal(0.23, 1.25);
  crash.position.set(-0.42, 0, 0.75);
  g.add(crash);
  const ride = cymbal(0.26, 1.1);
  ride.position.set(0.55, 0, 0.62);
  g.add(ride);
  return g;
}

export function buildInstrument(kind: InstrumentKind): Group {
  if (kind === 'drums') return drumKit();
  if (kind === 'bass') return guitar(true, 0x1d5fbf);
  return guitar(false, 0xc7362f);
}
