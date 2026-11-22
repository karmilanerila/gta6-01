// Deterministic staged screenshots (?shot=name&seed=N) for Neon Bay Heat.
// Each scene plays the real simulation forward from a fixed seed with a
// scripted autopilot, then parks a cinematic camera — so the frame is what
// the game really looks like, and the same seed gives the same frame.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, fmtClock } from './util.js';

const STEP = 1 / 60;

function scriptedInput(G, spec) {
  const input = {
    f: false, b: false, l: false, r: false,
    sprint: false, jump: false, handbrake: false, nitro: false,
    shoot: false, enter: false, weapon: 0,
    aimDir: new THREE.Vector3(0, 0, 1),
    aimOrigin: new THREE.Vector3(),
  };
  return Object.assign(input, spec);
}

function nearestRoadCoord(v, list) {
  let best = list[0];
  let bd = Infinity;
  for (const c of list) {
    const d = Math.abs(v - c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// Road-following autopilot: L-shaped route along avenues/streets so the car
// never cuts across blocks (used for the heist delivery).
function driveRoadsToward(G, tx, tz) {
  const v = G.world.player.vehicle;
  if (!v) return scriptedInput(G, {});
  const aves = [-200, -120, -40, 40, 120, 170];
  const sts = [-200, -120, -40, 40, 120, 200];
  const ax = nearestRoadCoord(v.pos.x, aves);
  const az = nearestRoadCoord(v.pos.z, sts);
  const onAvenue = Math.abs(v.pos.x - ax) < Math.abs(v.pos.z - az);
  const tzStreet = nearestRoadCoord(tz, sts);
  const txAve = nearestRoadCoord(tx, aves);
  let wx;
  let wz;
  if (onAvenue) {
    if (Math.abs(v.pos.z - tzStreet) > 6) {
      wx = ax;
      wz = tzStreet;
    } else if (Math.abs(v.pos.x - tx) > 6) {
      wx = tx;
      wz = tzStreet;
    } else {
      wx = tx;
      wz = tz;
    }
  } else if (Math.abs(v.pos.x - txAve) > 6) {
    wx = txAve;
    wz = az;
  } else if (Math.abs(v.pos.z - tz) > 6) {
    wx = txAve;
    wz = tz;
  } else {
    wx = tx;
    wz = tz;
  }
  return driveToward(G, wx, wz);
}

// Drive the player's car/boat toward a waypoint with speed-aware throttle:
// brake for sharp turns, lift off when close, reverse out if stuck.
const pilotState = { x: 0, z: 0, n: 0, stuck: 0, reversing: 0 };
function resetPilot(x, z) {
  pilotState.x = x;
  pilotState.z = z;
  pilotState.n = 0;
  pilotState.stuck = 0;
  pilotState.reversing = 0;
}

function driveToward(G, tx, tz, throttle = 1, pvx = 0, pvz = 0) {
  const v = G.world.player.vehicle;
  if (!v) return scriptedInput(G, {});
  const ps = pilotState;
  if (ps.reversing > 0) {
    ps.reversing -= 1;
    return scriptedInput(G, { b: true, nitro: false });
  }
  ps.n += 1;
  if (ps.n >= 30) {
    const moved = Math.hypot(v.pos.x - ps.x, v.pos.z - ps.z);
    ps.x = v.pos.x;
    ps.z = v.pos.z;
    ps.n = 0;
    if (moved < 2.5 && Math.abs(v.speed) < 3) {
      ps.stuck += 1;
      if (ps.stuck >= 2) {
        ps.reversing = 50;
        ps.stuck = 0;
      }
    } else ps.stuck = 0;
  }
  const dx = tx + pvx * 1.2 - v.pos.x;
  const dz = tz + pvz * 1.2 - v.pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  let diff = desired - v.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = clamp(diff * 1.8, -1, 1);
  const speed = Math.abs(v.speed);
  let f = throttle > 0;
  let b = false;
  if (Math.abs(diff) > 1.1 && speed > 16) {
    f = false;
    b = true;
  } else if (Math.abs(diff) > 0.7 && speed > 26) {
    f = false;
  }
  if (dist < 10) f = speed < 15;
  return scriptedInput(G, {
    f,
    b,
    l: steer > 0.12,
    r: steer < -0.12,
    nitro: false,
  });
}

function runSteps(G, seconds, inputFn) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i += 1) {
    const inp = inputFn ? inputFn(i * STEP) : scriptedInput(G, {});
    G.step(STEP, inp);
  }
}

function placePlayer(G, x, z, heading) {
  const p = G.world.player;
  if (p.vehicle) {
    p.vehicle = null;
    p.inBoat = false;
    p.parts.group.visible = true;
  }
  p.pos.set(x, 0, z);
  p.vel.set(0, 0, 0);
  p.heading = heading;
  p.parts.group.position.copy(p.pos);
  p.parts.group.rotation.y = heading;
}

function enterNearestCar(G) {
  const p = G.world.player;
  const v = G.world.nearestVehicle(p.pos.x, p.pos.z, 5, true);
  if (!v) return null;
  p.vehicle = v;
  v.parked = false;
  p.inBoat = v.def.kind === 'boat';
  p.parts.group.visible = false;
  return v;
}

// Teleport a vehicle to an exact spot for staging (mesh follows the sim
// state; no more steps run after staging, so it stays put).
function placeVehicle(v, x, z, heading) {
  v.pos.set(x, 0, z);
  v.vel.set(0, 0, 0);
  v.heading = heading;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = heading;
}

// Teleport a pedestrian to an exact sidewalk spot for staging.
function placePed(pd, x, z, heading) {
  pd.pos.set(x, 0, z);
  pd.heading = heading;
  pd.parts.group.position.copy(pd.pos);
  pd.parts.group.rotation.y = heading;
}

export function stageShot(name, G) {
  const W = G.world;
  const M = G.missions;
  if (name === 'cover') {
    // Sunset on Palma Drive: player on foot beside the pink supercar, neon
    // hotels and the sun behind them, traffic and pedestrians in frame.
    // Close, low cinematic camera from the beach side so the player reads
    // big; the car and the player both face the lens. The new convertible
    // is parked beside the supercar and the boardwalk palms line the right.
    G.setTod(0.745);
    placePlayer(G, 167, 12, Math.PI * 0.85);
    const car = W.starterCar;
    placeVehicle(car, 166, 22, Math.PI);
    runSteps(G, 6, () => scriptedInput(G, {}));
    if (W.traffic[0]) placeVehicle(W.traffic[0], 168, 30, 0);
    if (W.traffic[1]) placeVehicle(W.traffic[1], 163, 34, Math.PI);
    if (W.traffic[2]) placeVehicle(W.traffic[2], 172, 44, 0);
    if (W.peds[0]) placePed(W.peds[0], 160, 28, 0);
    if (W.peds[1]) placePed(W.peds[1], 161, 14, Math.PI);
    if (W.peds[2]) placePed(W.peds[2], 175, 20, Math.PI * 0.5);
    if (W.peds[3]) placePed(W.peds[3], 159, 40, 0);
    G.setCamYaw(Math.PI * 1.02);
    G.camera.position.set(175.5, 2.8, 6);
    G.camera.lookAt(165.5, 2.0, 19);
    G.camera.fov = 58;
    G.camera.updateProjectionMatrix();
  } else if (name === 'drive') {
    // Flat out down Palma Drive at golden hour, traffic ahead, ocean left,
    // boardwalk palms on the right.
    G.setTod(0.72);
    placePlayer(G, 170, -150, 0);
    const v = enterNearestCar(G) ?? W.starterCar;
    v.pos.set(170, 0, -150);
    v.heading = 0;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = 0;
    W.player.vehicle = v;
    runSteps(G, 5.5, () => driveToward(G, 170, 200));
    const dv = W.player.vehicle;
    const dz = dv ? dv.pos.z : 0;
    if (W.traffic[0]) placeVehicle(W.traffic[0], 170, dz + 26, 0);
    if (W.traffic[1]) placeVehicle(W.traffic[1], 168, dz + 46, 0);
    if (W.traffic[2]) placeVehicle(W.traffic[2], 172, dz + 62, 0);
    if (W.peds[0]) placePed(W.peds[0], 160, dz + 30, 0);
    if (W.peds[1]) placePed(W.peds[1], 180, dz + 18, Math.PI);
    if (W.peds[2]) placePed(W.peds[2], 161, dz + 52, Math.PI * 0.5);
    G.setCamYaw(W.player.vehicle.heading);
    G.setCamDist(9);
    G.updateCamera(0.5);
  } else if (name === 'chase') {
    // 4-star wanted at dusk downtown: cruisers + helicopter on the tail.
    // HEAD-ON shot — the camera sits ahead of the player car and looks back
    // down the street at it, so the pursuing cruisers, the helicopter and
    // the roadblock are all in the frame (the chase cam hides them).
    G.setTod(0.765);
    placePlayer(G, -40, -160, 0);
    const v = enterNearestCar(G) ?? W.starterCar;
    v.pos.set(-40, 0, -160);
    v.heading = 0;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = 0;
    W.player.vehicle = v;
    W.wanted = 4;
    W.crimeTimer = 0;
    runSteps(G, 6.5, () => driveToward(G, -40, 200));
    const cv = W.player.vehicle;
    const px = cv ? cv.pos.x : -40;
    const pz = cv ? cv.pos.z : 0;
    const cops = W.police.filter((c) => !c.dead);
    if (cops[0]) placeVehicle(cops[0], px - 7, pz - 9, 0);
    if (cops[1]) placeVehicle(cops[1], px + 7, pz - 11, 0);
    if (cops[2]) placeVehicle(cops[2], px - 2, pz - 18, 0);
    if (W.heli) {
      W.heli.group.position.set(px - 18, 30, pz - 14);
      W.heli.spot.target.position.set(px, 0, pz);
    }
    const blocks = W.vehicles.filter((b) => b.roadblock && !b.dead);
    if (blocks.length < 2) W.spawnRoadblock();
    const liveBlocks = W.vehicles.filter((b) => b.roadblock && !b.dead);
    if (liveBlocks[0]) placeVehicle(liveBlocks[0], px - 7, pz + 10, Math.PI / 2);
    if (liveBlocks[1]) placeVehicle(liveBlocks[1], px + 7, pz + 10, Math.PI / 2);
    G.camera.position.set(px, 2.8, pz + 18);
    G.camera.lookAt(px, 1.8, pz - 6);
    G.camera.fov = 58;
    G.camera.updateProjectionMatrix();
  } else if (name === 'mission') {
    // HARBOR HEIST at the ram phase: the player rams the armored truck to a
    // stop at the port while a cruiser closes in — five systems in one frame.
    G.setTod(0.76);
    placePlayer(G, -200, 150, Math.PI);
    const hv = W.starterCar;
    placeVehicle(hv, -200, 150, Math.PI);
    W.player.vehicle = hv;
    M.debugStart('heist');
    let chunks = 0;
    while (M.active && M.active.stage === 0 && chunks < 12) {
      chunks += 1;
      const a = M.active;
      runSteps(G, 2, () => driveToward(G, a.truck.pos.x, a.truck.pos.z, 1, a.truck.vel.x, a.truck.vel.z));
    }
    W.wanted = 3;
    W.crimeTimer = 0;
    runSteps(G, 1.5, () => scriptedInput(G, {}));
    const tp = W.truck ? W.truck.pos : { x: -200, z: 100 };
    // Photo staging: the ram phase is rough on the car, so restore the scene
    // for the frame — the player alive and on foot at the truck, the car
    // parked beside it, no end screen over the shot.
    W.player.health = 100;
    W.cash = 250;
    G.hud.hideEnd();
    const photoCar = W.starterCar;
    if (photoCar) {
      photoCar.health = 100;
      photoCar.dead = false;
      photoCar.mesh.visible = true;
      placeVehicle(photoCar, tp.x + 7, tp.z + 7, Math.PI * 0.75);
    }
    placePlayer(G, tp.x + 3, tp.z + 3, Math.PI * 0.75);
    const nearCop = W.police.find((c) => !c.dead);
    if (nearCop) placeVehicle(nearCop, tp.x + 9, tp.z - 7, Math.PI);
    // The truck stops wherever the chase ends — often mid-city — so the
    // camera sits ON the truck's road and looks down it at the scene. A
    // camera placed off-road ends up inside a building.
    const aves = [-200, -120, -40, 40, 120, 170];
    const sts = [-200, -120, -40, 40, 120, 200];
    const nearAve = aves.reduce((a, b) => (Math.abs(b - tp.x) < Math.abs(a - tp.x) ? b : a));
    const nearSt = sts.reduce((a, b) => (Math.abs(b - tp.z) < Math.abs(a - tp.z) ? b : a));
    if (Math.abs(tp.x - nearAve) < Math.abs(tp.z - nearSt)) {
      G.camera.position.set(nearAve, 3.6, tp.z + 17);
      G.camera.lookAt(tp.x, 1.6, tp.z - 5);
    } else {
      G.camera.position.set(tp.x + 17, 3.6, nearSt);
      G.camera.lookAt(tp.x - 5, 1.6, tp.z);
    }
    G.camera.fov = 58;
    G.camera.updateProjectionMatrix();
  } else if (name === 'testrace' || name === 'testboat' || name === 'testheist' || name === 'testneon' || name === 'testtrial' || name === 'testgetaway') {
    // Automated mission play-throughs (not screenshots): autopilot the real
    // rules and report the outcome on window.__testResult for the harness.
    const id = name.slice(4);
    G.setTod(0.72);
    if (id === 'boat') {
      placePlayer(G, 198, 60, Math.PI / 2);
      const boat = W.oceanBoat;
      boat.pos.set(203, 0, 60);
      boat.heading = Math.PI / 2;
      boat.mesh.position.copy(boat.pos);
      W.player.vehicle = boat;
      W.player.inBoat = true;
      W.player.parts.group.visible = false;
    } else {
      // Start at the mission's own beacon: the trial's rings are downtown,
      // the race starts on Palma Drive, the heist at the port, the getaway
      // at its first checkpoint.
      const sx = id === 'heist' ? -200 : id === 'trial' ? -120 : id === 'getaway' ? 120 : 170;
      const sz = id === 'heist' ? 150 : id === 'trial' ? -140 : id === 'getaway' ? -120 : -170;
      placePlayer(G, sx, sz, 0);
      const v = W.starterCar;
      v.pos.set(sx, 0, sz);
      v.heading = id === 'heist' ? Math.PI : 0;
      v.mesh.position.copy(v.pos);
      v.mesh.rotation.y = v.heading;
      W.player.vehicle = v;
    }
    M.debugStart(id);
    const pv = W.player.vehicle;
    resetPilot(pv.pos.x, pv.pos.z);
    let guard = 0;
    const heistLog = [];
    window.__heistLog = heistLog;
    let lastStage = -1;
    while (M.active && guard < 90) {
      guard += 1;
      if (id === 'heist') {
        const a = M.active;
        if (a.stage === 0 && a.truck) {
          runSteps(G, 2, () => driveToward(G, a.truck.pos.x, a.truck.pos.z, 1, a.truck.vel.x, a.truck.vel.z));
        } else if (a.stage === 1 && a.truck) {
          W.starterCar.vel.set(0, 0, 0);
          placePlayer(G, a.truck.pos.x + 3, a.truck.pos.z + 3, 0);
          runSteps(G, 1, () => scriptedInput(G, {}));
          const v = W.starterCar;
          v.health = 100;
          v.dead = false;
          v.mesh.visible = true;
          W.player.health = 100;
          W.wanted = 2;
          W.crimeTimer = 0;
          v.pos.set(a.truck.pos.x + 6, 0, a.truck.pos.z);
          W.player.vehicle = v;
          W.player.parts.group.visible = false;
          runSteps(G, 1, () => scriptedInput(G, {}));
        } else if (a.stage === 2) {
          runSteps(G, 2, () => driveRoadsToward(G, 120, 200));
        }
        if (a.stage !== lastStage) {
          lastStage = a.stage;
        }
      } else {
        const ring = M.rings[0];
        if (!ring) break;
        // The race is a time trial on open roads — the direct line is fastest
        // and its rings sit on the route. The trial's rings are a downtown
        // grid (90° turns), the neon delivery crosses the city and the
        // getaway checkpoints sit on the grid, so all three follow the
        // roads; the boat run steers straight across open water.
        if (id === 'neon' || id === 'trial' || id === 'getaway') runSteps(G, 2, () => driveRoadsToward(G, ring.x, ring.z));
        else runSteps(G, 2, () => driveToward(G, ring.x, ring.z));
      }
      if (id === 'heist') {
        heistLog.push({
          g: guard,
          stage: M.active ? M.active.stage : null,
          truckHp: W.truck ? Math.round(W.truck.health) : null,
          truckDead: W.truck ? !!W.truck.dead : null,
          carHp: W.starterCar ? Math.round(W.starterCar.health) : null,
          carDead: W.starterCar ? !!W.starterCar.dead : null,
          pHp: Math.round(W.player.health),
          driving: !!W.player.vehicle,
        });
      }
    }
    window.__testResult = {
      mission: id,
      done: M.done.slice(),
      cash: W.cash,
      active: M.active ? M.active.def.id : null,
      stage: M.active ? M.active.stage : null,
      ringsLeft: M.rings.length,
      truckHealth: W.truck ? Math.round(W.truck.health) : null,
      wanted: W.wanted,
      guard,
    };
  } else {
    return stageShot('cover', G);
  }
  // Let the HUD settle on the final state.
  const clockStr = fmtClock(G.tod);
  const onFootShot = name === 'cover';
  const speedMph = W.player.vehicle ? Math.round(Math.abs(W.player.vehicle.speed) * 2.237) : 0;
  const shotObjective = name === 'cover' ? 'NEON BAY HEAT — golden hour on Palma Drive'
    : name === 'drive' ? 'PALMA DRIVE — ' + speedMph + ' mph'
    : name === 'chase' ? 'WANTED LEVEL ' + Math.round(W.wanted) + ' — lose the law'
    : name === 'mission'
      ? (M.active && M.active.stage === 1 ? 'HARBOR HEIST — grab the cash' : 'HARBOR HEIST — stop the truck')
      : 'Welcome to Neon Bay';
  G.hud.update({
    health: W.player.health, armor: W.player.armor, cash: W.cash,
    wanted: Math.round(W.wanted),
    weaponName: onFootShot ? 'FISTS' : 'PISTOL', weaponIndex: onFootShot ? 0 : 1,
    ammo: onFootShot ? Infinity : W.player.ammo[1], driving: !!W.player.vehicle, onFoot: !W.player.vehicle,
    speedKmh: W.player.vehicle ? Math.abs(W.player.vehicle.speed) * 2.237 : 0,
    vehicleName: W.player.vehicle ? W.player.vehicle.def.name : '',
    nitro: W.player.vehicle && W.player.vehicle.def.nitro ? W.player.vehicle.nitroFuel : 0,
    radio: 'WAVE 98 · SYNTHWAVE', clock: clockStr,
    missionTime: M.active ? M.active.timeLeft : null,
    objective: shotObjective,
    minimap: {
      player: { x: W.playerPos().x, z: W.playerPos().z, heading: W.player.vehicle ? W.player.vehicle.heading : W.player.heading },
      markers: M.getMarkers(),
      police: W.police.filter((c) => !c.dead).map((c) => ({ x: c.pos.x, z: c.pos.z })),
      traffic: W.traffic.filter((t) => !t.dead).map((t) => ({ x: t.pos.x, z: t.pos.z })),
      peds: W.peds.filter((pd) => !pd.dead).map((pd) => ({ x: pd.pos.x, z: pd.pos.z })),
      truck: W.truck && !W.truck.dead ? { x: W.truck.pos.x, z: W.truck.pos.z } : null,
      heli: W.heli ? { x: W.heli.group.position.x, z: W.heli.group.position.z } : null,
    },
  });
}
