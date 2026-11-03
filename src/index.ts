import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { JamSystem } from './jam-system.js';
import { music } from './music/engine.js';
import { loadSavedSongs } from './music/library.js';
import { PanelSystem } from './panel.js';
import { ShowSystem } from './show-system.js';

// Start reading the player's saved songs right away, in parallel with the
// 3D world loading, so they're in the song list as soon as possible.
void loadSavedSongs();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(ShowSystem);
  world.registerSystem(JamSystem);
  world.registerSystem(PanelSystem);
});

// Development only: lets scripted tests and video capture read the app state.
if (import.meta.env.DEV) {
  (window as unknown as { __jam: unknown }).__jam = { music };
}
