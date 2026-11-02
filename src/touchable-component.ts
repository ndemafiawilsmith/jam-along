import { createComponent, Types } from '@iwsdk/core';

/**
 * Anything the player can play or press: keyboard keys and control buttons.
 * Works with a fingertip poke (real hands), a pinch-ray (hands in the
 * emulator), a controller trigger, or a mouse click on desktop.
 */
export const Touchable = createComponent('Touchable', {
  /** 0 = keyboard key, 1 = control button, 2 = drum pad. */
  kind: { type: Types.Int32, default: 0 },
  /** Key index, or button action id. */
  value: { type: Types.Int32, default: 0 },
});

export const TOUCH_KEY = 0;
export const TOUCH_BUTTON = 1;
export const TOUCH_PAD = 2;

export const ACTION_PREV_SONG = 1;
export const ACTION_NEXT_SONG = 2;
export const ACTION_PLAY = 3;
export const ACTION_SOUND = 4;
export const ACTION_INSTRUMENT = 5;
