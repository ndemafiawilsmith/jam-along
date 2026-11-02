import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { JamSystem } from './jam-system.js';
import { PanelSystem } from './panel.js';
import { ShowSystem } from './show-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(ShowSystem);
  world.registerSystem(JamSystem);
  world.registerSystem(PanelSystem);
});
