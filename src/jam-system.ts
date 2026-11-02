/**
 * The player's side of Jam Along: the keyboard, the control buttons, and
 * every way of pressing them.
 *
 * - Real hands: poke a key with an index fingertip (speed sets loudness).
 * - Hands in the emulator / controllers: point and pinch (or trigger).
 * - Desktop browser: click, or use the computer keyboard (A S D F ...).
 */

import {
  createSystem,
  Entity,
  Group,
  Hovered,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { KEY_COUNT, music } from './music/engine.js';
import { keyName, SONGS } from './music/songs.js';
import {
  BUTTON_DEPTH,
  ButtonVisual,
  buildButton,
  buildKey,
  buildKeyboardBase,
  buildSpark,
  drawLabel,
  KEY_DEPTH,
  KEY_HEIGHT,
  KEY_PITCH,
  KEY_WIDTH,
  KeyVisual,
  STAGE_TOP,
  STAGE_Z,
} from './stage.js';
import {
  ACTION_NEXT_SONG,
  ACTION_PLAY,
  ACTION_PREV_SONG,
  ACTION_SOUND,
  TOUCH_BUTTON,
  TOUCH_KEY,
  Touchable,
} from './touchable-component.js';

/** Where the keyboard sits: in front of a seated player, at lap/table height. */
const KEYBOARD_POS = new Vector3(0, 0.86, -0.42);
const KEYBOARD_TILT = 0.2;
const PANEL_POS = new Vector3(0, 1.1, -0.66);
const PANEL_TILT = -0.32;

const SPARKS = 28;
const SPARK_LIFE = 1.6;
const RETRIGGER = 0.09; // seconds before the same key can fire again

const COMPUTER_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"];

interface PokeTarget {
  entity: Entity;
  frame: Group;
  /** Half sizes of the touch volume in the frame's local space. */
  hx: number;
  hy: number;
  hz: number;
  /** Local axis the finger travels along to press it. */
  axis: 'y' | 'z';
  inside: [boolean, boolean];
  lastFire: number;
}

interface Spark {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  vel: Vector3;
  age: number;
}

export class JamSystem extends createSystem({
  pressed: { required: [Touchable, Pressed] },
  hovered: { required: [Touchable, Hovered] },
}) {
  private keys: KeyVisual[] = [];
  private keyHit = new Float32Array(KEY_COUNT).fill(-10);
  private keyVel = new Float32Array(KEY_COUNT);
  private keyChordTone = new Uint8Array(KEY_COUNT);
  private buttons = new Map<number, ButtonVisual>();
  private targets: PokeTarget[] = [];
  private sparks: Spark[] = [];
  private nextSpark = 0;

  private tmpInv = new Matrix4();
  private tmpLocal = new Vector3();
  private tipPos = [new Vector3(), new Vector3()];
  private tipPrev = [new Vector3(), new Vector3()];
  private tipSpeed = new Float32Array(2);
  private stageTarget = new Vector3(0, STAGE_TOP + 1.4, STAGE_Z);
  private lastBar = -1;
  private elapsed = 0;

  init(): void {
    this.buildKeyboard();
    this.buildPanel();
    this.buildSparks();
    this.refreshLabels();
    this.updateChordTones();

    this.queries.pressed.subscribe('qualify', (entity) => {
      this.fire(entity, 0.8);
    });

    const unsub = music.onChange(() => {
      this.refreshLabels();
      this.updateChordTones();
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const idx = COMPUTER_KEYS.indexOf(k);
      if (idx >= 0) this.playKey(idx, 0.85);
      else if (k === ' ') {
        e.preventDefault();
        music.togglePlay();
      } else if (k === 'n') music.nextSong();
      else if (k === 'b') music.prevSong();
      else if (k === 'm') music.nextSound();
    };
    const unlock = (): void => music.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', unlock);
    this.cleanupFuncs.push(
      unsub,
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('pointerdown', unlock),
    );
  }

  // ------------------------------------------------------------ building

  private buildKeyboard(): void {
    const width = KEY_COUNT * KEY_PITCH + 0.05;
    const base = buildKeyboardBase(width);
    base.position.copy(KEYBOARD_POS);
    base.rotation.x = KEYBOARD_TILT;
    const keyboard = this.world.createTransformEntity(base, { persistent: true });

    for (let i = 0; i < KEY_COUNT; i++) {
      const key = buildKey(i, KEY_COUNT);
      key.frame.position.set((i - (KEY_COUNT - 1) / 2) * KEY_PITCH, 0, 0);
      const entity = this.world.createTransformEntity(key.frame, keyboard);
      entity.addComponent(Touchable, { kind: TOUCH_KEY, value: i });
      entity.addComponent(RayInteractable);
      this.keys.push(key);
      this.targets.push({
        entity,
        frame: key.frame,
        hx: KEY_WIDTH / 2 + 0.002,
        hy: KEY_HEIGHT / 2,
        hz: KEY_DEPTH / 2,
        axis: 'y',
        inside: [false, false],
        lastFire: -10,
      });
    }
  }

  private buildPanel(): void {
    const panel = new Group();
    panel.name = 'Controls';
    panel.position.copy(PANEL_POS);
    panel.rotation.x = PANEL_TILT;
    const panelEntity = this.world.createTransformEntity(panel, { persistent: true });

    const layout: Array<[action: number, x: number, w: number, accent: number]> = [
      [ACTION_PREV_SONG, -0.415, 0.075, 0x7a5cff],
      [0, -0.235, 0.26, 0x000000],
      [ACTION_NEXT_SONG, -0.055, 0.075, 0x7a5cff],
      [ACTION_PLAY, 0.12, 0.16, 0xff4fa0],
      [ACTION_SOUND, 0.33, 0.2, 0x3fd0ff],
    ];
    const h = 0.085;
    for (const [action, x, w, accent] of layout) {
      const button = buildButton(w, h, accent);
      button.frame.position.x = x;
      const entity = this.world.createTransformEntity(button.frame, panelEntity);
      this.buttons.set(action, button);
      if (action === 0) continue; // the song display isn't pressable
      entity.addComponent(Touchable, { kind: TOUCH_BUTTON, value: action });
      entity.addComponent(RayInteractable);
      this.targets.push({
        entity,
        frame: button.frame,
        hx: w / 2,
        hy: h / 2,
        hz: BUTTON_DEPTH / 2,
        axis: 'z',
        inside: [false, false],
        lastFire: -10,
      });
    }
  }

  private buildSparks(): void {
    const holder = new Group();
    holder.name = 'Sparks';
    for (let i = 0; i < SPARKS; i++) {
      const mesh = buildSpark();
      holder.add(mesh);
      this.sparks.push({ mesh, vel: new Vector3(), age: SPARK_LIFE });
    }
    this.world.createTransformEntity(holder, { persistent: true });
  }

  private refreshLabels(): void {
    const song = music.song;
    const label = (action: number, title: string, sub = '', color?: string): void => {
      const b = this.buttons.get(action);
      if (b) drawLabel(b, title, sub, color);
    };
    label(ACTION_PREV_SONG, '‹');
    label(ACTION_NEXT_SONG, '›');
    label(
      0,
      song.name,
      `${song.vibe} · ${keyName(song)} · ${music.songIndex + 1}/${SONGS.length}`,
    );
    label(ACTION_PLAY, music.playing ? '■ Stop' : '▶ Play', '', music.playing ? '#ffd1e6' : '#ffffff');
    label(ACTION_SOUND, music.sound, 'tap to change sound');
  }

  private updateChordTones(): void {
    const song = music.song;
    const chord = song.chords[music.barIndex()];
    for (let i = 0; i < KEY_COUNT; i++) {
      const pc = music.notes[i] % 12;
      let hit = 0;
      if (music.playing) {
        for (const tone of chord.tones) {
          if ((song.rootMidi + chord.root + tone) % 12 === pc) hit = 1;
        }
      }
      this.keyChordTone[i] = hit;
    }
  }

  // ------------------------------------------------------------ actions

  private fire(entity: Entity, velocity: number): void {
    const kind = entity.getValue(Touchable, 'kind');
    const value = entity.getValue(Touchable, 'value') ?? 0;
    if (kind === TOUCH_KEY) {
      this.playKey(value, velocity);
      return;
    }
    switch (value) {
      case ACTION_PREV_SONG:
        music.prevSong();
        break;
      case ACTION_NEXT_SONG:
        music.nextSong();
        break;
      case ACTION_PLAY:
        music.togglePlay();
        break;
      case ACTION_SOUND:
        music.nextSound();
        break;
    }
    const b = this.buttons.get(value);
    if (b) b.face.position.z = -0.008;
  }

  private playKey(index: number, velocity: number): void {
    if (!music.playKey(index, velocity)) return;
    this.keyHit[index] = this.elapsed;
    this.keyVel[index] = velocity;
    this.emitSpark(index, velocity);
  }

  private emitSpark(index: number, velocity: number): void {
    const spark = this.sparks[this.nextSpark];
    this.nextSpark = (this.nextSpark + 1) % SPARKS;
    const key = this.keys[index];
    key.frame.getWorldPosition(spark.mesh.position);
    spark.mesh.position.y += 0.03;
    spark.vel
      .subVectors(this.stageTarget, spark.mesh.position)
      .normalize()
      .multiplyScalar(1.6 + velocity * 1.6);
    spark.vel.x += (Math.random() - 0.5) * 0.6;
    spark.vel.y += 0.9 + Math.random() * 0.5;
    spark.mesh.material.color.copy(key.color);
    spark.mesh.scale.setScalar(0.8 + velocity * 1.4);
    spark.mesh.visible = true;
    spark.age = 0;
  }

  // ------------------------------------------------------------ per frame

  update(delta: number): void {
    this.elapsed += delta;
    const t = this.elapsed;

    const bar = music.barIndex();
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      this.updateChordTones();
    }

    this.pollFingertips(delta);

    // Keys: sink and flash when hit; chord tones breathe on the beat.
    const beat = music.beatPhase();
    const pulse = music.playing ? Math.exp(-beat * 5) : 0;
    for (let i = 0; i < KEY_COUNT; i++) {
      const key = this.keys[i];
      const since = t - this.keyHit[i];
      const hit = since < 1 ? Math.exp(-since * 9) : 0;
      key.cap.position.y = -0.008 * Math.min(1, hit * 1.5);
      const hover = this.isHovered(i) ? 0.35 : 0;
      key.cap.material.emissiveIntensity =
        0.22 + this.keyChordTone[i] * (0.18 + 0.25 * pulse) + hover + hit * (1.5 + this.keyVel[i] * 2);
    }

    // Buttons spring back after a press.
    this.buttons.forEach((b) => {
      b.face.position.z *= 0.8;
    });

    // Sparks fly from the key toward the band.
    for (let i = 0; i < SPARKS; i++) {
      const s = this.sparks[i];
      if (s.age >= SPARK_LIFE) continue;
      s.age += delta;
      s.vel.y -= 1.2 * delta;
      s.mesh.position.addScaledVector(s.vel, delta);
      const life = 1 - s.age / SPARK_LIFE;
      s.mesh.material.opacity = life * life;
      if (s.age >= SPARK_LIFE) s.mesh.visible = false;
    }
  }

  private isHovered(index: number): boolean {
    for (const e of this.queries.hovered.entities) {
      if (
        e.getValue(Touchable, 'kind') === TOUCH_KEY &&
        e.getValue(Touchable, 'value') === index
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Fingertip poke detection. Each target is tested in its own local space so
   * the tilt of the keyboard and panel doesn't matter.
   */
  private pollFingertips(delta: number): void {
    const tips = this.player.indexTipSpaces;
    for (let h = 0; h < 2; h++) {
      const space = h === 0 ? tips.left : tips.right;
      space.getWorldPosition(this.tipPos[h]);
      const moved = this.tipPos[h].distanceTo(this.tipPrev[h]);
      this.tipSpeed[h] = delta > 0 ? moved / delta : 0;
      this.tipPrev[h].copy(this.tipPos[h]);
    }

    for (const target of this.targets) {
      target.frame.updateWorldMatrix(true, false);
      this.tmpInv.copy(target.frame.matrixWorld).invert();
      for (let h = 0; h < 2; h++) {
        const p = this.tmpLocal.copy(this.tipPos[h]).applyMatrix4(this.tmpInv);
        let inside: boolean;
        if (target.axis === 'y') {
          inside =
            Math.abs(p.x) < target.hx &&
            Math.abs(p.z) < target.hz &&
            p.y < target.hy + 0.004 &&
            p.y > -target.hy - 0.035;
        } else {
          inside =
            Math.abs(p.x) < target.hx &&
            Math.abs(p.y) < target.hy &&
            p.z < target.hz + 0.004 &&
            p.z > -target.hz - 0.035;
        }
        if (inside && !target.inside[h] && this.elapsed - target.lastFire > RETRIGGER) {
          target.lastFire = this.elapsed;
          const velocity = Math.min(1, Math.max(0.3, this.tipSpeed[h] / 1.2));
          this.fire(target.entity, velocity);
        }
        target.inside[h] = inside;
      }
    }
  }
}
