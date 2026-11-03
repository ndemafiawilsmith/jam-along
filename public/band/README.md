# Band models

Rigged band members go here as `.glb` files, listed in `band.json`. Roles
without a model keep the built-in stand-in figures.

```json
{
  "members": [
    { "role": "singer",    "model": "nathan.glb",  "rig": "singer", "height": 1.8 },
    { "role": "guitarist", "model": "person2.glb", "rig": "guitar", "height": 1.8 },
    { "role": "bassist",   "model": "person3.glb", "rig": "bass",   "height": 1.78 },
    { "role": "drummer",   "model": "person4.glb", "rig": "drums",  "height": 1.8 }
  ]
}
```

- `rig`: `singer`, `guitar`, `bass` or `drums` animates the skeleton in code
  (src/performer.ts), in time with the music. Use this for characters that only
  come with a walk or idle animation, such as RenderPeople scans. Needs
  RenderPeople/UE-style bone names (`hip`, `spine_01`, `upperarm_r`, ...) and a
  T-pose facing +Z.
- `rig`: `clip` (default) plays the model's own animation instead (e.g. a
  Mixamo "Playing Drums" clip), scaled to each song's tempo via `clipBpm`, with
  an optional separate `idle` file and an `instrument` attached to a bone.

Prepare a model for the Quest (WebP textures, no geometry compression):

```bash
FBX2glTF --binary --input person.fbx --output person
TEX=2048 node prep-band.mjs person.glb public/band/person.glb
```
