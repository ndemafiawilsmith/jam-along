# Band models

Rigged, animated band members go here as `.glb` files, listed in `band.json`.
Until `band.json` exists, the stage shows the built-in stand-in figures.

`band.json` example:

```json
{
  "members": [
    { "role": "singer",    "model": "singer.glb",    "idle": "singer-idle.glb",    "clipBpm": 100, "height": 1.75 },
    { "role": "guitarist", "model": "guitarist.glb", "idle": "guitarist-idle.glb", "clipBpm": 110,
      "instrument": { "kind": "guitar", "bone": "Spine", "position": [0, 0.05, 0.15], "rotation": [0, 0, 20] } },
    { "role": "bassist",   "model": "bassist.glb",   "clipBpm": 100,
      "instrument": { "kind": "bass", "bone": "Spine", "position": [0, 0.05, 0.15], "rotation": [0, 0, 20] } },
    { "role": "drummer",   "model": "drummer.glb",   "clipBpm": 120,
      "instrument": { "kind": "drums" } }
  ]
}
```

Roles: `singer`, `guitarist`, `bassist`, `drummer`. Offsets are in metres,
rotations in degrees. `clipBpm` is the tempo the animation was performed at,
so the band speeds up or slows down to match each song.
