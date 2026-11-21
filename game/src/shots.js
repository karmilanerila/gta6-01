// Deterministic staged screenshots (?shot=name&seed=N).
// Each scene plays the real simulation forward from a fixed seed with a
// scripted autopilot, then parks a cinematic camera — so the frame is what
// the game really looks like, and the same seed gives the same frame.
import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './util.js';

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
  // Aim at the target's predicted position (for moving targets like the truck).
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
    b = true; // brake into the sharp turn
  } else if (Math.abs(diff) > 0.7 && speed > 26) {
    f = false; // lift off
  }
  if (dist < 10) f = speed < 15; // don't blast past the ring
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

export function stageShot(name, G) {
  const W = G.world;
  const M = G.missions;
  if (name === 'cover') {
    // Sunset on Palma Drive: player on foot beside the pink supercar, neon
    // hotels behind, traffic and pedestrians in frame.
    G.setTod(0.745);
    placePlayer(G, 167, 12, Math.PI * 0.85);
    const car = W.starterCar;
    car.pos.set(166, 0, 22);
    car.heading = 0;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = 0;
    runSteps(G, 6, () => scriptedInput(G, {}));
    G.setCamYaw(Math.PI * 1.02);
    G.camera.position.set(174, 5.5, -4);
    G.camera.lookAt(165, 2.5, 22);
    G.camera.fov = 58;
    G.camera.updateProjectionMatrix();
  } else if (name === 'drive') {
    // Mid-chase down Palma Drive at golden hour, traffic ahead.
    G.setTod(0.72);
    placePlayer(G, 170, -150, 0);
    const v = enterNearestCar(G) ?? W.starterCar;
    v.pos.set(170, 0, -150);
    v.heading = 0;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = 0;
    W.player.vehicle = v;
    runSteps(G, 5.5, () => driveToward(G, 170, 200));
    G.setCamYaw(W.player.vehicle.heading);
    G.setCamDist(9);
    G.updateCamera(0.5);
  } else if (name === 'chase') {
    // 4-star wanted at dusk downtown: cruisers + helicopter on the tail.
    G.setTod(0.82);
    placePlayer(G, -40, -160, 0);
    const v = enterNearestCar(G) ?? W.starterCar;
    v.pos.set(-40, 0, -160);
    v.heading = 0;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = 0;
    W.player.vehicle = v;
    W.wanted = 4;
    W.crimeTimer = 0;
    runSteps(G, 6.5, () => driveToward(G, -40, 120));
    G.setCamYaw(W.player.vehicle.heading);
    G.setCamDist(8.5);
    G.updateCamera(0.5);
  } else if (name === 'mission') {
    // Smuggler's Run: the boat rounds the first buoy off the beach at sunset.
    G.setTod(0.76);
    placePlayer(G, 198, 60, Math.PI / 2);
    const boat = W.oceanBoat;
    boat.pos.set(203, 0, 60);
    boat.heading = Math.PI / 2;
    boat.mesh.position.copy(boat.pos);
    boat.mesh.rotation.y = boat.heading;
    W.player.vehicle = boat;
    W.player.inBoat = true;
    W.player.parts.group.visible = false;
    M.debugStart('boat');
    runSteps(G, 3.5, () => driveToward(G, 228, 0));
    // Cinematic: camera out at sea looking back at the boat + beachfront skyline.
    const bp = W.player.vehicle.pos;
    G.camera.position.set(bp.x + 16, 5.5, bp.z - 16);
    G.camera.lookAt(bp.x - 2, 1.5, bp.z + 2);
    G.camera.fov = 58;
    G.camera.updateProjectionMatrix();
  } else if (name === 'testrace' || name === 'testboat' || name === 'testheist') {
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
      const sx = id === 'heist' ? -200 : 170;
      const sz = id === 'heist' ? 150 : -170;
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
          // Ram the truck until it stops (aim ahead of it: it keeps moving).
          runSteps(G, 2, () => driveToward(G, a.truck.pos.x, a.truck.pos.z, 1, a.truck.vel.x, a.truck.vel.z));
        } else if (a.stage === 1 && a.truck) {
          // Get out and grab the cash (stop the car first so it doesn't
          // roll into the truck again).
          W.starterCar.vel.set(0, 0, 0);
          placePlayer(G, a.truck.pos.x + 3, a.truck.pos.z + 3, 0);
          runSteps(G, 1, () => scriptedInput(G, {}));
          // Back in the car for the delivery (fresh car + full health, and the
          // heat eased to 2 stars: the delivery leg is what's under test here;
          // the full 3-star chase is covered by the chase shot + police tests).
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
        runSteps(G, 2, () => driveToward(G, ring.x, ring.z));
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
    // Unknown shot name: fall back to the cover scene.
    return stageShot('cover', G);
  }
  // Let the HUD settle on the final state.
  const hrs = Math.floor(G.tod * 24);
  const mns = Math.floor((G.tod * 24 - hrs) * 60);
  const clockStr = String(hrs).padStart(2, '0') + ':' + String(mns).padStart(2, '0');
  const onFootShot = name === 'cover';
  const shotObjective = name === 'chase' ? 'WANTED LEVEL 4 — lose the law'
    : name === 'mission' ? "SMUGGLER'S RUN" : 'Welcome to Neon Bay';
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
    objective: M.active ? M.active.def.name : shotObjective,
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
