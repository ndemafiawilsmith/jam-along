/**
 * The show: the venue's moving lights, LED screen and colour wash, plus the
 * band. Everything follows the music engine (beat, drum hits, loudness and
 * the player's own notes).
 *
 * Band members are procedural figures by default. When rigged, animated
 * models are available (see band.ts), they replace the figures one by one.
 */

import { Color, createSystem, FogExp2, PointLight, SpotLight, Vector3 } from '@iwsdk/core';
import { BandRig, loadBand } from './band.js';
import { music } from './music/engine.js';
import { buildBassist, buildDrummer, buildGuitarist, buildSinger, Musician } from './stage.js';
import { aimHead, buildRoom, Room, SPOTS, STAGE_FRONT, STAGE_TOP, STAGE_Z } from './venue.js';

type Role = 'singer' | 'guitarist' | 'bassist' | 'drummer';

export class ShowSystem extends createSystem({}) {
  private room!: Room;
  private figures = new Map<Role, Musician>();
  private rigs = new Map<Role, BandRig>();
  private spots: SpotLight[] = [];
  private fill!: PointLight;

  private hueColor = new Color();
  private tmpColor = new Color();
  private target = new Vector3();
  private t = 0;
  private level = 0;
  private screenTick = 0;

  init(): void {
    this.room = buildRoom();
    this.world.createTransformEntity(this.room.root, { persistent: true });

    // Haze: distant parts of the venue fade into the dark, like a real gig.
    this.world.scene.fog = new FogExp2(0x07050b, 0.045);

    // A few real lights so the band and props pick up colour.
    for (const x of [-2.2, 2.2]) {
      const s = new SpotLight(0xffffff, 18, 12, 0.5, 0.6, 1.4);
      s.position.set(x, 4.1, STAGE_FRONT + 0.4);
      s.target.position.set(x * 0.4, STAGE_TOP + 1, STAGE_Z);
      this.world.createTransformEntity(s, { persistent: true });
      this.world.createTransformEntity(s.target, { persistent: true });
      this.spots.push(s);
    }
    this.fill = new PointLight(0xffd6b0, 6, 9, 1.6);
    this.fill.position.set(0, 2.2, STAGE_FRONT + 1.6);
    this.world.createTransformEntity(this.fill, { persistent: true });

    const place = (role: Role, m: Musician): void => {
      m.root.position.copy(SPOTS[role]);
      m.root.rotation.y = role === 'guitarist' ? -0.35 : role === 'bassist' ? 0.35 : 0;
      this.world.createTransformEntity(m.root, { persistent: true });
      this.figures.set(role, m);
    };
    place('singer', buildSinger());
    place('guitarist', buildGuitarist());
    place('bassist', buildBassist());
    place('drummer', buildDrummer());

    // Swap in rigged, animated musicians when their models are available.
    void loadBand((role, rig) => {
      const fig = this.figures.get(role as Role);
      if (fig) fig.root.visible = false;
      rig.root.position.copy(SPOTS[role as Role]);
      rig.root.rotation.y = role === 'guitarist' ? -0.3 : role === 'bassist' ? 0.3 : 0;
      this.world.createTransformEntity(rig.root, { persistent: true });
      this.rigs.set(role as Role, rig);
    });
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

    const r = this.room;
    r.floorRing.material.color.copy(this.hueColor);
    r.floorRing.material.opacity = 0.22 + kick * 0.55 + player * 0.25;
    r.floorRing.scale.setScalar(1 + kick * 0.08);
    r.stageEdge.material.color.copy(this.hueColor);
    r.stageEdge.material.opacity = 0.45 + kick * 0.55;
    r.wash.material.color.setHSL(hue, 0.8, 0.5);
    r.wash.material.opacity = 0.06 + this.level * 0.25 + kick * 0.08;
    for (const lamp of r.ampLeds) lamp.opacity = 0.35 + bass * 0.5;

    // ---- moving heads: slow sweeps when idle, livelier with the music
    const speed = playing ? 1 : 0.35;
    for (let i = 0; i < r.heads.length; i++) {
      const h = r.heads[i];
      const p = h.phase + t * 0.55 * speed;
      if (h.pool.visible) {
        // Front lights scan the stage floor.
        this.target.set(
          h.aim.x + Math.sin(p) * 1.4,
          STAGE_TOP,
          h.aim.z + Math.cos(p * 0.8) * 0.9,
        );
      } else {
        // Back lights fan up into the haze above the stage.
        this.target.set(h.aim.x + Math.sin(p * 0.7) * 3, h.aim.y, h.aim.z + Math.cos(p) * 2.5);
      }
      aimHead(h, this.target);
      const hit = i % 2 === 0 ? kick : snare;
      this.tmpColor.setHSL((hue + i * 0.06) % 1, 0.95, 0.55);
      h.beam.material.color.copy(this.tmpColor);
      h.beam.material.opacity = (playing ? 0.13 : 0.06) + hit * 0.12 + player * 0.04;
      h.lens.material.color.copy(this.tmpColor);
      h.pool.material.color.copy(this.tmpColor);
      h.pool.material.opacity = (playing ? 0.18 : 0.09) + hit * 0.2;
    }
    for (let i = 0; i < this.spots.length; i++) {
      this.spots[i].color.setHSL((hue + 0.5 + i * 0.1) % 1, 0.7, 0.6);
      this.spots[i].intensity = (playing ? 16 : 9) + (i ? snare : kick) * 14;
    }
    this.fill.intensity = 4 + this.level * 6;

    // ---- LED screen (redrawn every other frame; it's a low-res texture)
    this.screenTick ^= 1;
    if (this.screenTick) this.drawScreen(t, hue, kick, playing, player);

    // ---- band
    for (const rig of this.rigs.values()) rig.update(delta, playing, song.bpm);
    this.animateFigures(t, playing, beat, kick, snare, hat, bass, player);
  }

  private drawScreen(t: number, hue: number, kick: number, playing: boolean, player: number): void {
    const { ctx, w, h, texture } = this.room.screen;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue * 360}, 80%, ${8 + kick * 10}%)`);
    g.addColorStop(1, `hsl(${((hue + 0.18) % 1) * 360}, 80%, ${5 + kick * 6}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (playing || player > 0.05) {
      // Mirrored spectrum, bass in the middle, like the old LED bars.
      const data = music.freqData;
      const cols = 40;
      const cw = w / cols;
      for (let i = 0; i < cols; i++) {
        const d = Math.abs(i - (cols / 2 - 0.5));
        const bin = Math.min(data.length - 1, Math.floor(d * 1.4) + 1);
        const v = data[bin] / 255;
        const bh = Math.max(2, v * v * h * 1.05);
        ctx.fillStyle = `hsl(${((hue + d * 0.012) % 1) * 360}, 90%, ${45 + v * 30}%)`;
        ctx.fillRect(i * cw + 0.5, h - bh, cw - 1, bh);
      }
      // A ring that bursts out from the centre on every kick.
      if (kick > 0.05) {
        ctx.strokeStyle = `rgba(255,255,255,${kick * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, (1 - kick) * w * 0.45 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Logo, softly breathing; dimmer while the music plays.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 15px system-ui, sans-serif';
    const a = playing ? 0.35 : 0.85 + 0.15 * Math.sin(t * 2);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillText('JAM ALONG', w / 2, playing ? 14 : h / 2 - 6);
    if (!playing) {
      ctx.font = '600 8px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(music.song.name.toUpperCase(), w / 2, h / 2 + 12);
    }
    texture.needsUpdate = true;
  }

  private animateFigures(
    t: number,
    playing: boolean,
    beat: number,
    kick: number,
    snare: number,
    hat: number,
    bass: number,
    player: number,
  ): void {
    const groove = playing ? 1 : 0.15;
    for (const [role, m] of this.figures) {
      if (!m.root.visible) continue;
      m.glow.emissive.copy(this.hueColor);
      m.glow.emissiveIntensity = 0.18 + kick * 0.4 * groove + this.level * 0.3;
      const nod = playing ? Math.pow(1 - beat, 3) : 0.5 + 0.5 * Math.sin(t * 1.6);
      m.head.rotation.x = 0.09 + nod * 0.18 * groove;
      m.torso.rotation.z = Math.sin(t * 1.4 + m.root.position.x) * 0.04 * (1 + groove);
      m.root.position.y = SPOTS[role].y + player * 0.03;
    }
    const d = this.figures.get('drummer')!;
    d.armL.rotation.x = -0.9 - snare * 0.7;
    d.armR.rotation.x = -0.9 - hat * 0.45;
    d.hitParts[0].scale.set(1 + kick * 0.08, 1, 1 + kick * 0.08);
    d.hitParts[1].position.y = 0.72 - snare * 0.015;
    d.hitParts[2].rotation.z = hat * 0.15;
    d.torso.position.y = 0.5 - kick * 0.02;

    const b = this.figures.get('bassist')!;
    b.armR.rotation.x = -0.5 - bass * 0.5;
    b.hitParts[0].scale.setScalar(1 + bass * 0.05);
    const strum = playing ? Math.sin(beat * Math.PI * 4) : 0;
    const g = this.figures.get('guitarist')!;
    g.armR.rotation.x = -0.5 + strum * 0.35 * groove;
    g.hitParts[0].scale.setScalar(1 + hat * 0.04);

    const s = this.figures.get('singer')!;
    s.torso.rotation.y = Math.sin(t * 0.9) * 0.12 * (0.4 + groove);
    s.armL.rotation.x = -0.25 - (playing ? Math.max(0, Math.sin(t * 1.7)) * 0.9 : 0);
  }
}
