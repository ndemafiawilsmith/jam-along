import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { music } from './music/engine.js';

/** Wires the welcome panel's Enter VR / Exit buttons. */
export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (xrButton == null || exitButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    const launchXR = (): void => {
      // Entering VR is a user gesture, so it's the moment to unlock audio.
      music.unlock();
      this.world.launchXR();
    };
    const exitXR = (): void => this.world.exitXR();
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((state) => {
        const is2D = state === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        // Pause the band when the headset is taken off or a system menu opens.
        if (state === VisibilityState.VisibleBlurred && music.playing) music.stop();
      }),
    );
  }
}
