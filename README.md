# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/karmilanerila/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/karmilanerila/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Sunset Keys** — an open-world crime game set in Coral Bay Keys, a sun-soaked coastal archipelago. You are Kai, a driver new to the Keys, working off a debt to Marina, the fixer who runs the marina. Drive a living city on foot and by car, outrun the patrol, and run six jobs: a sunset race, a pier delivery, a clean getaway, an armored-truck heist, a boat run through the buoys, and a neon-gate trial through downtown. Spend your cash on paint, armor, a pistol and faster cars at the island's four shops. Two procedural radio stations, a day/night cycle, traffic, pedestrians, a five-star wanted system with a police helicopter, and a save that follows you.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step, no network — the game is static files under `game/`, and `main.ts` hands it in by copying `game/` and `screenshots/` to the output directory and writing `dossier.json`.

## Controls

| Keys | Action |
|---|---|
| WASD / arrows | Drive or walk |
| Shift | Sprint on foot · nitro in a car |
| Space | Handbrake (drift) |
| E | Enter / exit a car · open a shop · start a job |
| R | Switch radio station |
| M | Mute |
| Click | Shoot (with a pistol from Key Arms) |
| Esc | Pause |

## The city

Coral Bay Keys is a street grid wrapped around a beach, a pier and open sea: a highway ring, a neon downtown, a marina with a boat dock, parks, and a safehouse. The clock runs from golden hour through dusk into night, when the neon signs and street lamps come alive and the headlights cut through the dark.

## Jobs (all six pay out)

1. **Sunset Sprint** — $1,800. Five checkpoints across the Keys, 150 seconds.
2. **Pier Run** — $1,500. A parcel from the marina to the end of the pier, 110 seconds.
3. **Clean Getaway** — $2,000. Stay free under a three-star wanted level for 45 seconds, then reach the safehouse.
4. **Vault Truck** — $3,500. Ram the armored truck until its vault pops, then grab the cash.
5. **Island Hop** — $2,800. Take the runabout from the dock, round four buoys, come home.
6. **Neon Gates** — $2,200. Eight neon gates through downtown, 120 seconds.

## Shops

- **Sunset Paint** — repaint your car ($300).
- **Key Arms** — body armor ($400) and a pistol ($600).
- **Marina Motors** — buy the Comet GT ($2,500), the Sunset Spyder ($1,800) or the Bay Runner ($1,200).
- **The Fixer** — wipe your wanted level ($500 a star).

## Systems

- **Wanted (1–5 stars):** patrol cars chase and ram, roadblocks form at three stars, a helicopter with a searchlight joins at four. Break line of sight and the heat cools off.
- **Traffic & pedestrians:** fourteen cars drive the grid, twenty-two islanders walk the sidewalks and flee danger.
- **Radio:** Sunset FM (synthwave) and Keys 101 (island breeze), both synthesized live with Web Audio, plus engine, siren, collision and jingle sounds.
- **Save:** cash, finished jobs, owned cars, paint and radio station persist in localStorage.
- **Screenshots:** four staged renders in `screenshots/` — the coastal highway at golden hour, a night chase downtown, the vault-truck heist, and the boat run.

## Files

- `main.ts` — the entrypoint (Node 22, standard library only).
- `game/index.html` — the game page.
- `game/src/` — one file per system: `util`, `city`, `vehicles`, `police`, `peds`, `world`, `missions`, `audio`, `hud`, `shop`, `effects`, `shots`, `main`.
- `serve.ts` — the local dev server.
- `shots.json` — the four screenshot definitions.

## Screenshots

The four renders in `screenshots/` are staged from the game itself (`?shot=cover|downtown|heist|boat`):

1. `1-cover.jpg` — golden hour on the coastal highway.
2. `2-drive.jpg` — a four-star night chase in neon downtown.
3. `3-chase.jpg` — the Vault Truck heist at dusk.
4. `4-mission.jpg` — the Island Hop boat run on open water.

Run the self-check with `?verify=1` — it walks all six missions through their objectives and reports the results.

---

Entered on [make.fun](https://make.fun/?ref=karmilanerila&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards
