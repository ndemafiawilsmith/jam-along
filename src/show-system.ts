/**
 * The band and the room: musicians that play along with the backing track,
 * light beams that pulse with the drums, and an LED wall that dances to the
 * actual sound coming out of the speakers.
 */

import { Color, createSystem, Matrix4, Object3D } from '@iwsdk/core';
import { music } from './music/engine.js';
import {
  buildBassist,
  buildDrummer,
  buildGuitarist,
  buildRoom,
  Musician,
  Room,
  STAGE_TOP,
  STAGE_Z,
} from './stage.js';

export class ShowSystem extends createSystem({}) {
  private room!: Room;
  private drummer!: Musician;
  private bassist!: Musician;
  private guitarist!: Musician;
  private band: Musician[] = [];

  private tmpMatrix = new Matrix4();
  private tmpObj = new Object3D();
  private hueColor = new Color();
  private barColor = new Color();
  private t = 0;
  private level = 0;

  init(): void {
    this.room = buildRoom();
    this.world.createTransformEntity(this.room.root, { persistent: true });

    this.drummer = buildDrummer();
    this.drummer.root.position.set(0, STAGE_TOP, STAGE_Z - 0.55);
    this.bassist = buildBassist();
    this.bassist.root.position.set(-1.8, STAGE_TOP, STAGE_Z + 0.2);
    this.bassist.root.rotation.y = 0.35;
    this.guitarist = buildGuitarist();
    this.guitarist.root.position.set(1.8, STAGE_TOP, STAGE_Z + 0.2);
    this.guitarist.root.rotation.y = -0.35;
    this.band = [this.drummer, this.bassist, this.guitarist];
    for (const m of this.band) {
      this.world.createTransformEntity(m.root, { persistent: true });
    }
  }

  update(delta: number): void {
    this.t += delta;
    const t = this.t;
    const playing = music.playing;
    const loud = music.sample();
    this.level += (loud - this.level) * Math.min(1, delta * 10);

    const kick = playing ? Math.exp(-music.since('kick') * 9) : 0;
    const snare = playing ? Math.exp(-music.since('snare') * 10) : 0;
    const hat = playing ? Math.exp(-music.since('hat') * 16) : 0;
    const bass = playing ? Math.exp(-music.since('bass') * 8) : 0;
    const player = Math.exp(-music.since('player') * 6);
    const beat = music.beatPhase();

    // Colour drifts with each chord change.
    const song = music.song;
    const hue = (song.hue + music.barIndex() * 0.045) % 1;
    this.hueColor.setHSL(hue, 0.9, 0.6);

    // ---- room
    const r = this.room;
    r.floorRing.material.color.copy(this.hueColor);
    r.floorRing.material.opacity = 0.25 + kick * 0.6 + player * 0.25;
    r.floorRing.scale.setScalar(1 + kick * 0.08);
    r.stageEdge.material.color.copy(this.hueColor);
    r.stageEdge.material.opacity = 0.5 + kick * 0.5;

    for (let i = 0; i < r.beams.length; i++) {
      const beam = r.beams[i];
      const phase = i * 1.7;
      beam.rotation.z = Math.sin(t * 0.6 + phase) * 0.35;
      beam.rotation.x = Math.cos(t * 0.45 + phase) * 0.2;
      beam.material.color.setHSL((hue + i * 0.08) % 1, 0.9, 0.6);
      beam.material.opacity = 0.03 + (playing ? 0.05 : 0) + (i % 2 === 0 ? kick : snare) * 0.09;
    }

    const bars = r.wallBars;
    const data = music.freqData;
    for (let i = 0; i < bars; i++) {
      // Mirror the spectrum so bass sits in the middle of the wall.
      const half = bars / 2;
      const d = Math.abs(i - (half - 0.5));
      const bin = Math.min(data.length - 1, Math.floor(d * 1.6) + 1);
      const v = playing || player > 0.05 ? data[bin] / 255 : 0;
      const idle = 0.06 + 0.04 * Math.sin(t * 1.5 + i * 0.5);
      const height = Math.max(idle, v * v * 3.2);
      this.tmpObj.position.set((i - (bars - 1) / 2) * 0.21, height / 2, 0);
      this.tmpObj.scale.set(1, height, 1);
      this.tmpObj.updateMatrix();
      this.tmpMatrix.copy(this.tmpObj.matrix);
      r.wall.setMatrixAt(i, this.tmpMatrix);
      this.barColor.setHSL((hue + d * 0.025) % 1, 0.85, 0.35 + v * 0.35);
      r.wall.setColorAt(i, this.barColor);
    }
    r.wall.instanceMatrix.needsUpdate = true;
    if (r.wall.instanceColor) r.wall.instanceColor.needsUpdate = true;

    // ---- band
    const groove = playing ? 1 : 0.15;
    for (const m of this.band) {
      m.glow.emissive.copy(this.hueColor);
      m.glow.emissiveIntensity = 0.22 + kick * 0.5 * groove + this.level * 0.4;
      // Everyone nods on the beat.
      const nod = playing ? Math.pow(1 - beat, 3) : 0.5 + 0.5 * Math.sin(t * 1.6);
      m.head.rotation.x = 0.05 + nod * 0.18 * groove + 0.04;
      m.torso.rotation.z = Math.sin(t * 1.4 + m.root.position.x) * 0.04 * (1 + groove);
    }

    // Drummer: left stick on snare, right stick on hi-hat, kick drum bounces.
    const d = this.drummer;
    d.armL.rotation.x = -0.9 - snare * 0.7;
    d.armR.rotation.x = -0.9 - hat * 0.45;
    d.hitParts[0].scale.set(1 + kick * 0.08, 1, 1 + kick * 0.08);
    d.hitParts[1].position.y = 0.72 - snare * 0.015;
    d.hitParts[2].rotation.z = hat * 0.15;
    d.torso.position.y = 0.5 - kick * 0.02;

    // Bassist plucks on bass notes, guitarist strums on the hi-hat.
    this.bassist.armR.rotation.x = -0.5 - bass * 0.5;
    this.bassist.hitParts[0].scale.setScalar(1 + bass * 0.05);
    const strum = playing ? Math.sin(beat * Math.PI * 4) : 0;
    this.guitarist.armR.rotation.x = -0.5 + strum * 0.35 * groove;
    this.guitarist.hitParts[0].scale.setScalar(1 + hat * 0.04);

    // The band reacts when the player plays: a little bounce of approval.
    for (const m of this.band) {
      m.root.position.y = STAGE_TOP + player * 0.03;
    }
  }
}
