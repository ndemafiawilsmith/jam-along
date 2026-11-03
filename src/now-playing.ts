/**
 * The "Now Playing" console: a big, readable song card plus clear transport
 * controls. Pure Three.js + canvas textures; JamSystem turns the buttons into
 * pressable entities and calls `refresh()` / `animate()`.
 *
 * Icons are drawn as shapes (not font glyphs) so they look the same on every
 * browser, including the Quest browser.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { music } from './music/engine.js';
import { keyName } from './music/songs.js';
import {
  ACTION_NEXT_SONG,
  ACTION_PLAY,
  ACTION_PREV_SONG,
  ACTION_INSTRUMENT,
  ACTION_SOUND,
} from './touchable-component.js';

export type Icon = 'play' | 'pause' | 'prev' | 'next' | 'sound' | 'keys' | 'drums';

export interface ConsoleButton {
  action: number;
  frame: Group;
  face: Mesh<BoxGeometry | CylinderGeometry, MeshStandardMaterial>;
  /** Half sizes of the touch volume (local x/y), and its thickness. */
  hx: number;
  hy: number;
  hz: number;
  baseGlow: number;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  /** 0..1, eased towards 1 while hovered. */
  hover: number;
}

const PANEL_W = 0.96;
const PANEL_H = 0.27;
const DEPTH = 0.02;

const PINK = 0xff4fa0;
const VIOLET = 0x7a5cff;
const CYAN = 0x3fd0ff;
const AMBER = 0xffa23f;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasTexture] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return [canvas, texture];
}

function labelPlane(w: number, h: number, texture: CanvasTexture): Mesh {
  const m = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  return m;
}

/** Shorten `text` with an ellipsis so it fits `maxW` at the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${Math.round(((h % 1) + 1) % 1 * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;
}

export class NowPlaying {
  readonly root = new Group();
  readonly buttons: ConsoleButton[] = [];

  private card: { canvas: HTMLCanvasElement; texture: CanvasTexture };
  private border: Mesh<BoxGeometry, MeshBasicMaterial>;
  private dots: Array<Mesh<CylinderGeometry, MeshBasicMaterial>> = [];
  private playButton!: ConsoleButton;
  private tint = new Color();

  constructor() {
    this.root.name = 'Now Playing';

    // Back plate with a glowing rim that takes on the song's colour.
    const plate = new Mesh(
      new BoxGeometry(PANEL_W, PANEL_H, DEPTH),
      new MeshStandardMaterial({ color: 0x0e0a16, roughness: 0.6, metalness: 0.1 }),
    );
    plate.position.z = -DEPTH;
    this.root.add(plate);
    this.border = new Mesh(
      new BoxGeometry(PANEL_W + 0.012, PANEL_H + 0.012, DEPTH * 0.6),
      new MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
    );
    this.border.position.z = -DEPTH - 0.004;
    this.root.add(this.border);

    // Song card: art tile, eyebrow, title, details.
    const cardW = 0.56;
    const cardH = 0.23;
    const [canvas, texture] = makeCanvas(1120, 460);
    this.card = { canvas, texture };
    const card = labelPlane(cardW, cardH, texture);
    card.position.set(-PANEL_W / 2 + 0.015 + cardW / 2, 0, 0.001);
    this.root.add(card);

    // Beat lights under the song details: one per beat of the bar.
    const dotGeo = new CylinderGeometry(0.012, 0.012, 0.004, 20);
    dotGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const dot = new Mesh(
        dotGeo,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, toneMapped: false }),
      );
      // Lines up with the text column on the card canvas.
      dot.position.set(card.position.x - cardW / 2 + cardW * (480 / 1120) + 0.012 + i * 0.034, -0.083, 0.003);
      this.root.add(dot);
      this.dots.push(dot);
    }

    // Divider between the card and the controls.
    const divider = new Mesh(new BoxGeometry(0.003, PANEL_H - 0.05, 0.002), new MeshBasicMaterial({ color: 0x3a2f4d }));
    divider.position.set(0.1, 0, 0.001);
    this.root.add(divider);

    // Transport row: prev, big play/pause, next. Sound selector underneath.
    const cx = 0.29;
    this.addButton(ACTION_PREV_SONG, 'box', cx - 0.13, 0.04, 0.085, 0.085, VIOLET, 0.35);
    this.playButton = this.addButton(ACTION_PLAY, 'disc', cx, 0.04, 0.13, 0.13, PINK, 0.55);
    this.addButton(ACTION_NEXT_SONG, 'box', cx + 0.13, 0.04, 0.085, 0.085, VIOLET, 0.35);
    // Bottom row: instrument switch (keys <-> drums) and sound / kit picker.
    this.addButton(ACTION_INSTRUMENT, 'box', cx - 0.0885, -0.085, 0.168, 0.062, AMBER, 0.4);
    this.addButton(ACTION_SOUND, 'box', cx + 0.0885, -0.085, 0.168, 0.062, CYAN, 0.35);

    this.refresh();
  }

  private addButton(
    action: number,
    shape: 'box' | 'disc',
    x: number,
    y: number,
    w: number,
    h: number,
    accent: number,
    baseGlow: number,
  ): ConsoleButton {
    const frame = new Group();
    frame.position.set(x, y, 0);
    let face: ConsoleButton['face'];
    const mat = new MeshStandardMaterial({
      color: new Color(accent).multiplyScalar(0.35),
      roughness: 0.4,
      emissive: accent,
      emissiveIntensity: baseGlow,
    });
    if (shape === 'disc') {
      const geo = new CylinderGeometry(w / 2, w / 2, DEPTH, 40);
      geo.rotateX(Math.PI / 2);
      face = new Mesh(geo, mat);
    } else {
      face = new Mesh(new BoxGeometry(w, h, DEPTH), mat);
    }
    frame.add(face);

    const aspect = w / h;
    const [canvas, texture] = makeCanvas(Math.round(256 * aspect), 256);
    const label = labelPlane(w * 0.92, h * 0.92, texture);
    label.position.z = DEPTH / 2 + 0.001;
    face.add(label);

    const button: ConsoleButton = {
      action,
      frame,
      face,
      hx: w / 2,
      hy: h / 2,
      hz: DEPTH / 2,
      baseGlow,
      canvas,
      texture,
      hover: 0,
    };
    this.root.add(frame);
    this.buttons.push(button);
    return button;
  }

  // ---------------------------------------------------------------- drawing

  private drawIcon(b: ConsoleButton, icon: Icon, text = ''): void {
    const ctx = b.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = b.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const cx = w / 2;
    const cy = h / 2;
    const s = h * 0.22;

    switch (icon) {
      case 'play':
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.75, cy - s);
        ctx.lineTo(cx + s * 1.05, cy);
        ctx.lineTo(cx - s * 0.75, cy + s);
        ctx.closePath();
        ctx.fill();
        break;
      case 'pause':
        ctx.beginPath();
        ctx.roundRect(cx - s * 0.85, cy - s, s * 0.6, s * 2, s * 0.15);
        ctx.roundRect(cx + s * 0.25, cy - s, s * 0.6, s * 2, s * 0.15);
        ctx.fill();
        break;
      case 'prev':
      case 'next': {
        const dir = icon === 'next' ? 1 : -1;
        ctx.lineWidth = h * 0.09;
        ctx.beginPath();
        ctx.moveTo(cx - dir * s * 0.45, cy - s * 0.9);
        ctx.lineTo(cx + dir * s * 0.45, cy);
        ctx.lineTo(cx - dir * s * 0.45, cy + s * 0.9);
        ctx.stroke();
        break;
      }
      case 'sound':
      case 'keys':
      case 'drums': {
        // Small glyph on the left, then the label.
        const gx = h * 0.4;
        if (icon === 'sound') {
          ctx.beginPath();
          ctx.ellipse(gx - h * 0.04, cy + h * 0.14, h * 0.1, h * 0.075, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = h * 0.045;
          ctx.beginPath();
          ctx.moveTo(gx + h * 0.045, cy + h * 0.12);
          ctx.lineTo(gx + h * 0.045, cy - h * 0.24);
          ctx.lineTo(gx + h * 0.2, cy - h * 0.16);
          ctx.stroke();
        } else if (icon === 'keys') {
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.roundRect(gx - h * 0.2 + i * h * 0.14, cy - h * 0.2, h * 0.11, h * 0.4, h * 0.03);
            ctx.fill();
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(gx, cy - h * 0.08, h * 0.2, h * 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(gx - h * 0.2, cy - h * 0.08, h * 0.4, h * 0.22);
          ctx.lineWidth = h * 0.04;
          ctx.beginPath();
          ctx.moveTo(gx - h * 0.05, cy - h * 0.18);
          ctx.lineTo(gx + h * 0.22, cy - h * 0.34);
          ctx.stroke();
        }
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.round(h * 0.38)}px system-ui, sans-serif`;
        ctx.fillText(text, h * 0.72, cy + h * 0.02, w - h * 0.8);
        break;
      }
    }
    b.texture.needsUpdate = true;
  }

  private drawCard(): void {
    const { canvas, texture } = this.card;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const song = music.song;
    const hue = song.hue;
    ctx.clearRect(0, 0, w, h);

    // Card background.
    ctx.fillStyle = 'rgba(28, 20, 40, 0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 34);
    ctx.fill();

    // Album-art tile, generated from the song's colour.
    const art = h - 60;
    const ax = 30;
    const ay = 30;
    const grad = ctx.createLinearGradient(ax, ay, ax + art, ay + art);
    grad.addColorStop(0, hsl(hue, 0.9, 0.55));
    grad.addColorStop(1, hsl(hue + 0.18, 0.85, 0.3));
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ax, ay, art, art, 26);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(ax, ay, art, art);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 7;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      for (let x = 0; x <= art; x += 8) {
        const y = ay + art * (0.25 + i * 0.13) + Math.sin(x / 34 + i * 1.3) * (14 + i * 4);
        if (x === 0) ctx.moveTo(ax + x, y);
        else ctx.lineTo(ax + x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Text column.
    const tx = ax + art + 40;
    const maxW = w - tx - 30;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Status line: import / loading messages take priority, in amber.
    ctx.font = '800 38px system-ui, sans-serif';
    if (music.status) {
      ctx.fillStyle = '#ffb860';
      ctx.fillText(fit(ctx, music.status.toUpperCase(), maxW), tx, 92);
    } else {
      ctx.fillStyle = music.playing ? hsl(hue, 1, 0.68) : 'rgba(255,255,255,0.6)';
      ctx.fillText(music.playing ? 'NOW PLAYING' : 'READY TO PLAY', tx, 92, maxW);
    }

    ctx.fillStyle = '#ffffff';
    // Long titles step down in size before being shortened.
    let titleSize = 92;
    ctx.font = `800 ${titleSize}px system-ui, sans-serif`;
    while (titleSize > 64 && ctx.measureText(song.name).width > maxW) {
      titleSize -= 8;
      ctx.font = `800 ${titleSize}px system-ui, sans-serif`;
    }
    ctx.fillText(fit(ctx, song.name, maxW), tx, 194);

    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '500 44px system-ui, sans-serif';
    ctx.fillText(
      fit(
        ctx,
        // Imported songs already carry a badge, so skip the style label.
        `${song.imported ? '' : `${song.vibe} · `}${keyName(song)} · ${Math.round(song.bpm)} BPM`,
        maxW,
      ),
      tx,
      262,
    );

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Song ${music.songIndex + 1} of ${music.songs.length}`, w - 34, h - 44);
    if (song.imported) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.fillText('★ IMPORTED', ax + 22, ay + art - 22);
    }

    texture.needsUpdate = true;
  }

  /** Redraw everything that depends on the song / transport state. */
  refresh(): void {
    this.drawCard();
    for (const b of this.buttons) {
      switch (b.action) {
        case ACTION_PREV_SONG:
          this.drawIcon(b, 'prev');
          break;
        case ACTION_NEXT_SONG:
          this.drawIcon(b, 'next');
          break;
        case ACTION_PLAY:
          this.drawIcon(b, music.playing ? 'pause' : 'play');
          break;
        case ACTION_SOUND:
          this.drawIcon(
            b,
            'sound',
            music.instrument === 'Drums' ? `Kit: ${music.kit}` : `Sound: ${music.sound}`,
          );
          break;
        case ACTION_INSTRUMENT:
          // Shows what you're playing now; tap to switch.
          this.drawIcon(b, music.instrument === 'Drums' ? 'drums' : 'keys', music.instrument);
          break;
      }
    }
  }

  /** Mark a button as just pressed (pushes it in). */
  press(action: number): void {
    const b = this.buttons.find((x) => x.action === action);
    if (b) b.face.position.z = -0.009;
  }

  /** Per-frame animation. `hovered(action)` reports pointer hover. */
  animate(delta: number, hovered: (action: number) => boolean): void {
    const song = music.song;
    const playing = music.playing;
    const phase = music.beatPhase();
    const pulse = playing ? Math.exp(-phase * 6) : 0;

    this.tint.setHSL(song.hue, 0.9, 0.6);
    this.border.material.color.copy(this.tint);
    this.border.material.opacity = playing ? 0.55 + pulse * 0.45 : 0.4;

    for (const b of this.buttons) {
      const target = hovered(b.action) ? 1 : 0;
      b.hover += (target - b.hover) * Math.min(1, delta * 14);
      b.face.position.z *= 0.8;
      b.face.material.emissiveIntensity = b.baseGlow + b.hover * 0.9;
      const s = 1 + b.hover * 0.06;
      b.frame.scale.set(s, s, 1);
    }

    // The play button breathes with the beat while music is on.
    const pb = this.playButton;
    const ps = 1 + pb.hover * 0.06 + pulse * 0.07;
    pb.frame.scale.set(ps, ps, 1);
    pb.face.material.emissiveIntensity += pulse * 0.6;

    // Beat lights: the current beat of the bar is lit.
    const beat = playing ? music.beatIndex() % 4 : -1;
    for (let i = 0; i < 4; i++) {
      const dot = this.dots[i];
      const on = i === beat;
      if (on) dot.material.color.copy(this.tint);
      else dot.material.color.set(0xffffff);
      dot.material.opacity = on ? 0.6 + pulse * 0.4 : 0.18;
      const ds = on ? 1.15 + pulse * 0.35 : 1;
      dot.scale.set(ds, ds, 1);
    }
  }
}
