// Sunset Keys — screenshot staging and the self-check harness.
// ?shot=cover|downtown|heist|boat stages a scene for the camera.
// ?verify=1 walks all six missions through their objectives and writes the
// results into #verify (and the console) so a headless run can read them.
// Written fresh for round 5.
import { makeVehicle } from './vehicles.js';
import { MISSIONS, startMission, updateMission } from './missions.js';
import { addWanted, updatePolice } from './police.js';
import { buyFromShop } from './shop.js';
import { fmtCash } from './util.js';

export function stageShot(G, name) {
  G.state = 'playing';
  G.verifyMode = false;
  const p = G.player;
  if (name === 'cover') {
    // Golden hour on the coastal highway: the Comet GT, traffic, the beach and the sea.
    G.clock = 17.4;
    const car = makeVehicle('comet', 2800, 1560, -Math.PI / 2, { color: '#ff2e63' });
    G.cars.push(car);
    // A sedan ahead in the same lane and a van overtaking, for depth.
    const ahead = makeVehicle('sedan', 2800, 1330, -Math.PI / 2, { color: '#4f7ec9' });
    ahead.vy = -140;
    ahead.speed = 140;
    G.cars.push(ahead);
    const van = makeVehicle('runner', 2740, 1700, -Math.PI / 2, { color: '#2ec4b6' });
    van.vy = -120;
    van.speed = 120;
    G.cars.push(van);
    p.car = car;
    p.onFoot = false;
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    car.vx = 0;
    car.vy = -260;
    car.speed = 260;
    G.camera.x = car.x;
    G.camera.y = car.y;
    G.message = 'SUNSET KEYS — Coral Bay';
    G.messageT = 99;
  } else if (name === 'downtown') {
    // Night in neon downtown, three stars, patrol cars closing in, the heli overhead.
    G.clock = 21.2;
    const car = makeVehicle('spyder', 1600, 1200, Math.PI / 2, { color: '#ffb400' });
    G.cars.push(car);
    p.car = car;
    p.onFoot = false;
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    car.vx = 0;
    car.vy = 200;
    car.speed = 200;
    G.wanted = 4;
    G.lastSeen = G.time;
    for (let i = 0; i < 2; i++) {
      const cop = makeVehicle('cruiser', 1600 + (i === 0 ? -160 : 160), 1200 + 220, -Math.PI / 2, {});
      G.cars.push(cop);
    }
    G.heli.active = true;
    G.heli.x = p.x + 180;
    G.heli.y = p.y - 120;
    G.camera.x = car.x;
    G.camera.y = car.y;
    G.message = 'WANTED — 4 stars';
    G.messageT = 99;
  } else if (name === 'heist') {
    // Dusk on the highway: the Vault Truck job in progress.
    G.clock = 18.2;
    startMission(G, 'heist');
    const car = makeVehicle('comet', 2060, 300, 0, { color: '#ff2e63' });
    G.cars.push(car);
    p.car = car;
    p.onFoot = false;
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    car.vx = 420;
    car.speed = 420;
    if (G.mission && G.mission.truck) {
      G.mission.truck.x = 2200;
      G.mission.truck.y = 300;
      G.mission.truck.angle = 0;
      G.mission.truck.hp = 260;
    }
    G.camera.x = 2120;
    G.camera.y = 300;
    G.message = 'VAULT TRUCK — ram it until it stops';
    G.messageT = 99;
  } else if (name === 'boat') {
    // Dusk on the open water: the Island Hop run, first buoy dead ahead.
    G.clock = 18.6;
    startMission(G, 'boat');
    const boat = G.mission && G.mission.boat ? G.mission.boat : makeVehicle('boat', 3400, 1050, -Math.PI / 2, {});
    if (!G.mission || !G.mission.boat) G.cars.push(boat);
    boat.x = 3400;
    boat.y = 1050;
    boat.angle = -Math.PI / 2;
    boat.vx = 0;
    boat.vy = -260;
    boat.speed = 260;
    p.car = boat;
    p.onFoot = false;
    p.x = boat.x;
    p.y = boat.y;
    p.angle = boat.angle;
    G.camera.x = boat.x;
    G.camera.y = boat.y;
    G.message = 'ISLAND HOP — round the buoys';
    G.messageT = 99;
  }
}

// ---- verification ---------------------------------------------------------

export function createVerify() {
  return { phase: 0, results: [], missionIdx: 0, cashBefore: 0, done: false, log: [] };
}

function vlog(V, line) {
  V.log.push(line);
  V.results.push(line);
  try { console.log('[verify] ' + line); } catch (e) { /* no console */ }
}

export function verifyStep(G, V, dt) {
  const p = G.player;
  switch (V.phase) {
    case 0: {
      const ok = G.city.buildings.length > 50 && G.cars.length >= 10 && G.peds.length >= 10;
      vlog(V, 'boot: buildings=' + G.city.buildings.length + ' cars=' + G.cars.length + ' peds=' + G.peds.length + ' ' + (ok ? 'OK' : 'FAIL'));
      V.phase = 1;
      break;
    }
    case 1: {
      // Drive the starter car: teleport the player into it and throttle.
      const starter = G.cars.find((c) => c.defId === 'spyder' && !c.traffic);
      if (starter) {
        p.car = starter;
        p.onFoot = false;
        p.x = starter.x;
        p.y = starter.y;
      }
      G.verifyInput = { up: true, down: false, left: false, right: false, sprint: false, handbrake: false, nitro: false, enter: false, enterMission: false, shoot: false };
      V.phase = 2;
      V.wait = 0;
      break;
    }
    case 2: {
      V.wait += dt;
      if (V.wait > 1.5) {
        const speed = p.car ? Math.abs(p.car.speed) : 0;
        vlog(V, 'drive: speed=' + Math.round(speed) + ' ' + (speed > 80 ? 'OK' : 'FAIL'));
        V.phase = 3;
        V.missionIdx = 0;
      }
      break;
    }
    case 3: {
      // Start the next mission.
      if (V.missionIdx >= MISSIONS.length) {
        V.phase = 8;
        break;
      }
      const def = MISSIONS[V.missionIdx];
      V.cashBefore = p.cash;
      // Put the player at the mission start, on foot or in a car as the mission needs.
      p.x = def.start.x;
      p.y = def.start.y;
      if (p.car) {
        p.car.x = def.start.x;
        p.car.y = def.start.y;
        p.car.vx = 0;
        p.car.vy = 0;
      }
      const ok = startMission(G, def.id);
      vlog(V, 'mission ' + def.id + ': start ' + (ok ? 'OK' : 'FAIL'));
      V.phase = 4;
      V.wait = 0;
      break;
    }
    case 4: {
      // Walk the mission's stages by placing the player on each objective.
      if (!G.mission) {
        const def = MISSIONS[V.missionIdx];
        // The mission already finished (its payout landed) — that is a pass,
        // not an abort: move on to the completion check.
        if (G.missionsDone[def.id]) {
          V.phase = 5;
          break;
        }
        vlog(V, 'mission ' + def.id + ': ABORTED EARLY FAIL (state=' + G.state + ' wanted=' + G.wanted + ' cash=' + Math.floor(p.cash) + ')');
        V.missionIdx += 1;
        V.phase = 3;
        break;
      }
      const m = G.mission;
      const stage = m.def.stages[m.stage];
      if (!stage) {
        V.phase = 5;
        break;
      }
      if (stage.kind === 'goto') {
        p.x = stage.x;
        p.y = stage.y;
        if (p.car) {
          p.car.x = stage.x;
          p.car.y = stage.y;
          p.car.vx = 0;
          p.car.vy = 0;
        }
        updateMission(G, dt);
      } else if (stage.kind === 'survive') {
        m.surviveT = stage.seconds;
        updateMission(G, dt);
      } else if (stage.kind === 'ram') {
        if (m.truck) m.truck.hp = 0;
        if (m.truck) m.truck.dead = true;
        updateMission(G, dt);
      } else if (stage.kind === 'collect') {
        if (m.truck) {
          p.x = m.truck.x;
          p.y = m.truck.y;
        }
        updateMission(G, dt);
      }
      V.wait += dt;
      if (V.wait > 2) {
        vlog(V, 'mission ' + m.def.id + ': stage stuck FAIL');
        V.missionIdx += 1;
        V.phase = 3;
      }
      break;
    }
    case 5: {
      const def = MISSIONS[V.missionIdx];
      const done = !!G.missionsDone[def.id];
      const paid = Math.floor(p.cash - V.cashBefore);
      vlog(V, 'mission ' + def.id + ': complete=' + (done ? 'OK' : 'FAIL') + ' payout=' + paid + ' expected=' + def.payout);
      V.missionIdx += 1;
      V.phase = 3;
      break;
    }
    case 8: {
      // Shop: buy paint at the paint shop.
      p.x = 1200;
      p.y = 252;
      const before = p.cash;
      const shop = G.city.shops.find((s) => s.id === 'paint');
      p.cash = Math.max(p.cash, 1000);
      const ok = buyFromShop(G, shop, 0);
      vlog(V, 'shop paint: buy=' + (ok ? 'OK' : 'FAIL') + ' cash ' + Math.floor(before) + '->' + Math.floor(p.cash));
      V.phase = 9;
      break;
    }
    case 9: {
      // Police: raise wanted, confirm a patrol car spawns and chases.
      addWanted(G, 3, 'verify');
      G.policeTimer = 0;
      updatePolice(G, 3);
      const cops = G.cars.filter((c) => c.police && !c.dead).length;
      vlog(V, 'police: wanted=' + G.wanted + ' cops=' + cops + ' ' + (cops >= 1 ? 'OK' : 'FAIL'));
      V.phase = 10;
      break;
    }
    case 10: {
      const fails = V.results.filter((r) => r.indexOf('FAIL') >= 0).length;
      vlog(V, 'VERIFY DONE fails=' + fails);
      V.done = true;
      const el = document.getElementById('verify');
      if (el) el.textContent = V.results.join('\n');
      break;
    }
    default:
      break;
  }
}
