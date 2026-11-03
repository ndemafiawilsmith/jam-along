import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { music } from './music/engine.js';
import { enableDropImport, pickFile } from './music/library.js';

/**
 * Wires the welcome panel: Enter VR / Exit, and Import song. Importing uses
 * the system file picker, so it is offered only outside VR.
 */
export class PanelSystem extends createSystem({}) {
  init(): void {
    this.cleanupFuncs.push(enableDropImport());

    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    const importButton = panel?.getElementById('import-button');
    const importHint = panel?.getElementById('import-hint');

    if (importButton) {
      const onImport = (): void => pickFile();
      importButton.addEventListener('click', onImport);
      this.cleanupFuncs.push(() => importButton.removeEventListener('click', onImport));
    }

    const xrEnabled = this.world.xrEnabled && xrButton != null && exitButton != null;
    if (!xrEnabled) {
      xrButton?.setProperties({ display: 'none' });
      exitButton?.setProperties({ display: 'none' });
    } else {
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
      );
    }

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const is2D = state === VisibilityState.NonImmersive;
        if (xrEnabled) {
          xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
          exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        }
        // File pickers don't work inside an immersive session.
        importButton?.setProperties({ display: is2D ? 'flex' : 'none' });
        importHint?.setProperties({ display: is2D ? 'flex' : 'none' });
        // Pause the band when the headset is taken off or a system menu opens.
        if (state === VisibilityState.VisibleBlurred && music.playing) music.stop();
      }),
    );
  }
}
