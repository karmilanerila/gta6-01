// Sunset Keys — the wanted system: stars, patrol cars, roadblocks and the heli.
// Written fresh for round 5.
import { clamp, wrapAngle, angleTo, dist, rand } from './util.js';
import { makeVehicle, driveVehicle } from './vehicles.js';
import { isOnRoad, nearestIntersection, STREETS_X, STREETS_Y } from './city.js';

export function addWanted(G, n, reason) {
  const before = G.wanted;
  G.wanted = clamp(G.wanted + n, 0, 5);
  if (G.wanted > before) {
    G.wantedFlash = 1.2;
    if (reason) G.message = reason + ' — wanted level ' + G.wanted + (G.wanted > 1 ? ' stars' : ' star');
    G.messageT = 3;
    // The first time the heat hits three stars, the patrol throws up a roadblock.
    if (before < 3 && G.wanted >= 3 && !G.roadblockDone) {
      G.roadblockDone = true;
      spawnRoadblock(G);
    }
  }
}

export function wantedCap(wanted) {
  if (wanted <= 0) return 0;
  if (wanted === 1) return 1;
  if (wanted === 2) return 2;
  if (wanted === 3) return 3;
  if (wanted === 4) return 4;
  return 5;
}

export function spawnPolice(G) {
  const px = G.player.x;
  const py = G.player.y;
  // Spawn on a nearby road, off-screen if possible.
  const spots = [];
  for (const sx of STREETS_X) {
    for (const sy of STREETS_Y) {
      const d = dist(px, py, sx, sy);
      if (d > 500 && d < 1100) spots.push({ x: sx, y: sy });
    }
  }
  if (spots.length === 0) spots.push({ x: px + 600, y: py });
  const s = spots[Math.floor(Math.random() * spots.length)];
  const car = makeVehicle('cruiser', s.x, s.y, angleTo(s.x, s.y, px, py), { police: true });
  car.siren = Math.random() * 2;
  G.cars.push(car);
  return car;
}

// A roadblock: two patrol cars parked across the road ahead of the player.
// Called once when the wanted level first reaches 3.
export function spawnRoadblock(G) {
  const p = G.player;
  const ahead = p.car ? p.car.angle : p.angle;
  const bx = p.x + Math.cos(ahead) * 420;
  const by = p.y + Math.sin(ahead) * 420;
  const perp = ahead + Math.PI / 2;
  for (const side of [-1, 1]) {
    const car = makeVehicle('cruiser', bx + Math.cos(perp) * 46 * side, by + Math.sin(perp) * 46 * side, perp, { police: true });
    car.vx = 0;
    car.vy = 0;
    G.cars.push(car);
  }
  G.message = 'Roadblock ahead — the patrol is boxing you in';
  G.messageT = 3;
}

function policeChase(G, car, dt) {
  const p = G.player;
  const tx = p.x + p.vx * 0.5;
  const ty = p.y + p.vy * 0.5;
  const want = angleTo(car.x, car.y, tx, ty);
  const steer = clamp(wrapAngle(want - car.angle) * 1.8, -1, 1);
  const d = dist(car.x, car.y, p.x, p.y);
  // Ram when close, otherwise full throttle; ease off when right on top of the player.
  const throttle = d < 70 ? 0.55 : 1;
  driveVehicle(car, { throttle, steer, handbrake: false }, dt, false);
  // Nudge the car back onto a road if it gets stuck on a block.
  if (!isOnRoad(car.x, car.y)) {
    const near = nearestIntersection(car.x, car.y);
    const back = angleTo(car.x, car.y, near.x, near.y);
    car.angle += clamp(wrapAngle(back - car.angle), -1, 1) * dt * 1.5;
  }
  if (car.speed < 6) car.stuck += dt;
  else car.stuck = 0;
  if (car.stuck > 3.5) {
    car.x += Math.cos(car.angle) * -60;
    car.y += Math.sin(car.angle) * -60;
    car.stuck = 0;
  }
}

export function updatePolice(G, dt) {
  // Spawn up to the cap.
  const cops = G.cars.filter((c) => c.police && !c.dead);
  const cap = wantedCap(G.wanted);
  if (cops.length < cap && G.wanted > 0) {
    G.policeTimer -= dt;
    if (G.policeTimer <= 0) {
      spawnPolice(G);
      G.policeTimer = 2.5;
    }
  }
  // Chase.
  for (const car of cops) policeChase(G, car, dt);

  // Helicopter at 4+ stars.
  if (G.wanted >= 4) {
    G.heli.active = true;
    G.heli.angle += dt * 0.55;
    G.heli.x = G.player.x + Math.cos(G.heli.angle) * 210;
    G.heli.y = G.player.y + Math.sin(G.heli.angle) * 210 - 60;
  } else {
    G.heli.active = false;
  }

  // Wanted decay: when no cop has been near the player for a while, stars fall.
  const nearCop = cops.some((c) => dist(c.x, c.y, G.player.x, G.player.y) < 520);
  if (nearCop) {
    G.lastSeen = G.time;
    G.decayT = 0;
  } else if (G.wanted > 0) {
    if (G.time - G.lastSeen > 9) {
      G.decayT += dt;
      if (G.decayT > 8) {
        G.wanted -= 1;
        G.decayT = 0;
        G.message = 'The heat is cooling off… wanted level ' + G.wanted;
        G.messageT = 2.5;
      }
    }
  }

  // Busted: on foot, slow, and a cop right on top of the player.
  if (G.player.onFoot && G.wanted > 0) {
    for (const car of cops) {
      if (dist(car.x, car.y, G.player.x, G.player.y) < 46 && Math.abs(G.player.speed) < 60) {
        G.bustT += dt;
        if (G.bustT > 1.6) {
          bustPlayer(G);
          return;
        }
      } else {
        G.bustT = Math.max(0, G.bustT - dt * 2);
      }
    }
  } else {
    G.bustT = 0;
  }
}

export function bustPlayer(G) {
  const fine = Math.min(600, Math.floor(G.player.cash * 0.25));
  G.player.cash -= fine;
  G.wanted = 0;
  G.bustT = 0;
  G.state = 'busted';
  G.stateT = 0;
  G.message = 'BUSTED — the Keys Patrol took $' + fine + ' in fines.';
  G.messageT = 4;
  // Respawn at the police station corner, on foot.
  G.player.onFoot = true;
  G.player.car = null;
  G.player.x = 1250;
  G.player.y = 350;
  G.player.vx = 0;
  G.player.vy = 0;
  G.player.health = 100;
  saveGame(G);
}

export function wastePlayer(G) {
  const lost = Math.min(800, Math.floor(G.player.cash * 0.3));
  G.player.cash -= lost;
  G.wanted = 0;
  G.state = 'wasted';
  G.stateT = 0;
  G.message = 'WASTED — you woke up at Coral Bay General, $' + lost + ' lighter.';
  G.messageT = 4;
  G.player.onFoot = true;
  G.player.car = null;
  G.player.x = 2400;
  G.player.y = 660;
  G.player.vx = 0;
  G.player.vy = 0;
  G.player.health = 100;
  G.player.armor = 0;
  saveGame(G);
}

export function saveGame(G) {
  try {
    const data = {
      cash: Math.floor(G.player.cash),
      done: G.missionsDone,
      owned: G.owned,
      paint: G.paint,
      radio: G.radioStation,
      weapon: G.weapon,
      armor: Math.floor(G.player.armor),
    };
    window.localStorage.setItem('sunset-keys-save-v5', JSON.stringify(data));
  } catch (e) {
    // Storage can be off; the session still plays.
  }
}

export function loadGame(G) {
  try {
    const raw = window.localStorage.getItem('sunset-keys-save-v5');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.cash === 'number') G.player.cash = s.cash;
    if (s.done && typeof s.done === 'object') G.missionsDone = s.done;
    if (s.owned && typeof s.owned === 'object') G.owned = s.owned;
    if (typeof s.paint === 'string') G.paint = s.paint;
    if (typeof s.radio === 'number') G.radioStation = s.radio;
    if (typeof s.weapon === 'boolean') G.weapon = s.weapon;
    if (typeof s.armor === 'number') G.player.armor = s.armor;
  } catch (e) {
    // A corrupt save is ignored.
  }
}

export function drawHeli(ctx, G) {
  if (!G.heli.active) return;
  const h = G.heli;
  // Searchlight cone on the ground.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#fff8c9';
  ctx.beginPath();
  ctx.moveTo(h.x, h.y);
  ctx.lineTo(G.player.x - 60, G.player.y - 40);
  ctx.lineTo(G.player.x + 60, G.player.y + 40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // The helicopter itself.
  ctx.save();
  ctx.translate(h.x, h.y - 26);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(3, 4, 26, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3a4a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff2020';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  const rotor = G.time * 22;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-34 * Math.cos(rotor), -34 * Math.sin(rotor));
  ctx.lineTo(34 * Math.cos(rotor), 34 * Math.sin(rotor));
  ctx.stroke();
  ctx.restore();
}
