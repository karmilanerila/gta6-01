// Sunset Keys — vehicles: definitions, arcade physics, traffic AI and drawing.
// Written fresh for round 5. No vehicle here is copied from an earlier build.
import { clamp, wrapAngle, angleTo, dist, rand, pick, mulberry32 } from './util.js';
import { isOnRoad, isWater, isBeach, nearestIntersection, STREETS_X, STREETS_Y, SEA_X } from './city.js';

export const VEHICLE_DEFS = {
  comet: {
    id: 'comet', name: 'Comet GT', kind: 'car',
    topSpeed: 540, accel: 300, brake: 460, grip: 3.1, turn: 2.7,
    hp: 100, len: 48, wid: 23, color: '#ff2e63', price: 2500,
    blurb: 'A track-bred coupe. Brutal speed, lively tail.',
  },
  spyder: {
    id: 'spyder', name: 'Sunset Spyder', kind: 'car',
    topSpeed: 450, accel: 240, brake: 400, grip: 3.9, turn: 3.0,
    hp: 130, len: 45, wid: 23, color: '#ffb400', price: 1800,
    blurb: 'An open-top cruiser. Balanced, forgiving, quick enough.',
  },
  runner: {
    id: 'runner', name: 'Bay Runner', kind: 'car',
    topSpeed: 350, accel: 180, brake: 360, grip: 4.4, turn: 2.3,
    hp: 220, len: 56, wid: 25, color: '#2ec4b6', price: 1200,
    blurb: 'A workhorse van. Slow, but it shrugs off collisions.',
  },
  sedan: {
    id: 'sedan', name: 'Island Sedan', kind: 'car',
    topSpeed: 270, accel: 150, brake: 320, grip: 4.2, turn: 2.4,
    hp: 90, len: 44, wid: 22, color: '#8a93a6', price: 0,
    blurb: 'Everyday traffic.',
  },
  cruiser: {
    id: 'cruiser', name: 'Keys Patrol', kind: 'police',
    topSpeed: 490, accel: 300, brake: 440, grip: 3.7, turn: 2.9,
    hp: 160, len: 47, wid: 23, color: '#e8ecf2', price: 0,
    blurb: 'Coral Bay police interceptor.',
  },
  truck: {
    id: 'truck', name: 'Vault Truck', kind: 'truck',
    topSpeed: 300, accel: 140, brake: 300, grip: 4.6, turn: 1.9,
    hp: 620, len: 66, wid: 27, color: '#3d6b8f', price: 0,
    blurb: 'An armored cash truck. Ram it until the vault pops.',
  },
  boat: {
    id: 'boat', name: 'Wave Runner', kind: 'boat',
    topSpeed: 400, accel: 210, brake: 260, grip: 1.4, turn: 2.2,
    hp: 160, len: 58, wid: 25, color: '#ffffff', price: 0,
    blurb: 'A fast runabout for the open water.',
  },
};

const TRAFFIC_COLORS = ['#c94f4f', '#4f7ec9', '#c9a44f', '#7a4fc9', '#4fc98a', '#c97a4f', '#9aa5b1'];

export function makeVehicle(defId, x, y, angle, opts) {
  const def = VEHICLE_DEFS[defId];
  const o = opts || {};
  return {
    def, defId,
    x, y, angle: angle || 0,
    vx: 0, vy: 0,
    speed: 0,
    hp: def.hp, maxHp: def.hp,
    color: o.color || def.color,
    traffic: !!o.traffic,
    police: defId === 'cruiser',
    mission: o.mission || null,
    target: o.target || null,
    stuck: 0,
    dead: false,
    siren: 0,
    brakeLight: false,
    wake: 0,
    id: o.id || ('v' + Math.floor(Math.random() * 1e9).toString(36)),
  };
}

export function forwardSpeed(v) {
  return v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
}

export function lateralSpeed(v) {
  return -v.vx * Math.sin(v.angle) + v.vy * Math.cos(v.angle);
}

// Arcade car physics: engine force along the nose, steering that follows speed,
// lateral grip that washes out under the handbrake (drift).
export function driveVehicle(v, input, dt, onWater) {
  const def = v.def;
  const grip = onWater ? def.grip * 0.55 : input.handbrake ? def.grip * 0.35 : def.grip;
  let fwd = forwardSpeed(v);
  let lat = lateralSpeed(v);

  // Steering: stronger at moderate speed, none when parked.
  const steerAuthority = clamp(Math.abs(fwd) / 110, 0, 1) * (input.handbrake ? 1.7 : 1);
  v.angle += input.steer * def.turn * steerAuthority * dt * (fwd >= 0 ? 1 : -1);
  v.angle = wrapAngle(v.angle);

  // Engine / brake / reverse.
  if (input.throttle > 0) fwd += def.accel * input.throttle * dt;
  else if (input.throttle < 0) fwd += def.brake * input.throttle * dt;
  // Drag and rolling resistance.
  fwd -= fwd * (onWater ? 0.35 : 0.55) * dt;
  if (Math.abs(fwd) < 2 && input.throttle === 0) fwd = 0;
  // Clamp to top speed (reverse is capped lower).
  const top = onWater ? def.topSpeed * 0.85 : def.topSpeed;
  fwd = clamp(fwd, -top * 0.45, top);

  // Grip eats lateral velocity; a handbrake keeps some slide.
  lat *= Math.exp(-grip * dt);
  if (input.handbrake && Math.abs(fwd) > 120) lat += input.steer * 26 * dt;

  const ca = Math.cos(v.angle);
  const sa = Math.sin(v.angle);
  v.vx = ca * fwd - sa * lat;
  v.vy = sa * fwd + ca * lat;
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  v.speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
  v.brakeLight = input.throttle < 0 || input.handbrake;
  return v;
}

// Simple circle-vs-circle bump between two vehicles; returns the impact speed.
export function bumpVehicles(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const min = (a.def.len + b.def.len) * 0.36;
  if (d >= min || d < 0.001) return 0;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = min - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const impact = Math.abs(rel);
  if (impact > 30) {
    const push = rel * 0.55;
    a.vx += nx * push;
    a.vy += ny * push;
    b.vx -= nx * push;
    b.vy -= ny * push;
  }
  return impact;
}

export function damageVehicle(v, amount) {
  if (v.dead) return false;
  v.hp -= amount;
  if (v.hp <= 0) {
    v.hp = 0;
    v.dead = true;
    return true;
  }
  return false;
}

// Put a vehicle back on the road, repaired and facing a given direction.
// Used when a mission repositions a car or the player respawns a ride.
export function resetVehicle(v, x, y, angle) {
  v.x = x;
  v.y = y;
  v.angle = angle;
  v.vx = 0;
  v.vy = 0;
  v.speed = 0;
  v.hp = v.maxHp;
  v.dead = false;
  v.stuck = 0;
  return v;
}

export function repairVehicle(v) {
  v.hp = v.maxHp;
  v.dead = false;
  return v;
}

// ---- traffic -------------------------------------------------------------

export function spawnTraffic(G, n) {
  const rng = mulberry32(777);
  for (let i = 0; i < n; i++) {
    const ix = STREETS_X[Math.floor(rng() * STREETS_X.length)];
    const iy = STREETS_Y[Math.floor(rng() * STREETS_Y.length)];
    const car = makeVehicle('sedan', ix + rand(rng, -30, 30), iy + rand(rng, -30, 30), rand(rng, 0, Math.PI * 2), {
      traffic: true, color: pick(rng, TRAFFIC_COLORS),
    });
    car.target = nearestIntersection(car.x + rand(rng, -500, 500), car.y + rand(rng, -500, 500));
    G.cars.push(car);
  }
}

function pickNextTarget(car, rng) {
  const cur = nearestIntersection(car.x, car.y);
  const options = [];
  for (const sx of STREETS_X) {
    if (Math.abs(sx - cur.x) < 1 && Math.abs(cur.y - 0) >= 0) {
      // Same column: neighbouring rows.
    }
  }
  // Neighbours: same street x, adjacent street y, or same y, adjacent x.
  const xs = STREETS_X;
  const ys = STREETS_Y;
  const xi = xs.indexOf(cur.x);
  const yi = ys.indexOf(cur.y);
  if (xi > 0) options.push({ x: xs[xi - 1], y: cur.y });
  if (xi < xs.length - 1) options.push({ x: xs[xi + 1], y: cur.y });
  if (yi > 0) options.push({ x: cur.x, y: ys[yi - 1] });
  if (yi < ys.length - 1) options.push({ x: cur.x, y: ys[yi + 1] });
  if (options.length === 0) return cur;
  return options[Math.floor(rng() * options.length)];
}

export function updateTraffic(G, dt) {
  const rng = G.trafficRng;
  for (const car of G.cars) {
    if (!car.traffic || car.dead) continue;
    if (!car.target) car.target = pickNextTarget(car, rng);
    const d = dist(car.x, car.y, car.target.x, car.target.y);
    if (d < 60) {
      car.target = pickNextTarget(car, rng);
    }
    // Slow for the car ahead.
    let ahead = false;
    for (const other of G.cars) {
      if (other === car || other.dead) continue;
      const dd = dist(car.x, car.y, other.x, other.y);
      if (dd < 90) {
        const ang = angleTo(car.x, car.y, other.x, other.y);
        const diff = Math.abs(wrapAngle(ang - car.angle));
        if (diff < 0.7) { ahead = true; break; }
      }
    }
    const want = angleTo(car.x, car.y, car.target.x, car.target.y);
    const steer = clamp(wrapAngle(want - car.angle) * 1.6, -1, 1);
    const throttle = ahead ? 0 : (d < 160 ? 0.45 : 0.75);
    driveVehicle(car, { throttle, steer, handbrake: false }, dt, false);
    // Keep traffic on the roads: nudge back toward the nearest street if it drifts.
    if (!isOnRoad(car.x, car.y) && !isBeach(car.x, car.y)) {
      const near = nearestIntersection(car.x, car.y);
      car.target = near;
    }
    if (car.speed < 4) car.stuck += dt;
    else car.stuck = 0;
    if (car.stuck > 4) {
      car.target = pickNextTarget(car, rng);
      car.stuck = 0;
    }
  }
}

// ---- drawing --------------------------------------------------------------

function drawCarBody(ctx, v, night) {
  const def = v.def;
  const L = def.len;
  const W = def.wid;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(-L / 2 + 3, -W / 2 + 4, L, W, 8);
  ctx.fill();
  // Body.
  ctx.fillStyle = v.color;
  ctx.beginPath();
  ctx.roundRect(-L / 2, -W / 2, L, W, 8);
  ctx.fill();
  // Hood + trunk shading.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(-L / 2 + 2, -W / 2 + 2, L * 0.22, W - 4, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.roundRect(L / 2 - L * 0.24, -W / 2 + 2, L * 0.22, W - 4, 6);
  ctx.fill();
  // Windshield + roof.
  ctx.fillStyle = 'rgba(20,28,44,0.9)';
  ctx.beginPath();
  ctx.roundRect(-L * 0.08, -W / 2 + 3, L * 0.2, W - 6, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.roundRect(L * 0.14, -W / 2 + 3, L * 0.16, W - 6, 4);
  ctx.fill();
  // Wheels.
  ctx.fillStyle = '#101014';
  const wy = W / 2 - 1;
  ctx.fillRect(-L * 0.32, -wy - 3, 12, 5);
  ctx.fillRect(L * 0.22, -wy - 3, 12, 5);
  ctx.fillRect(-L * 0.32, wy - 2, 12, 5);
  ctx.fillRect(L * 0.22, wy - 2, 12, 5);
  // Headlights.
  ctx.fillStyle = '#fff8c9';
  ctx.beginPath();
  ctx.arc(L / 2 - 1, -W / 2 + 5, 2.5, 0, Math.PI * 2);
  ctx.arc(L / 2 - 1, W / 2 - 5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Brake lights.
  if (v.brakeLight) {
    ctx.fillStyle = '#ff2020';
    ctx.beginPath();
    ctx.arc(-L / 2 + 1, -W / 2 + 5, 2.5, 0, Math.PI * 2);
    ctx.arc(-L / 2 + 1, W / 2 - 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Headlight beams at night.
  if (night > 0.45) {
    const g = ctx.createLinearGradient(L / 2, 0, L / 2 + 130, 0);
    g.addColorStop(0, 'rgba(255,240,180,0.20)');
    g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L / 2, -W / 2 + 4);
    ctx.lineTo(L / 2 + 130, -W - 8);
    ctx.lineTo(L / 2 + 130, W + 8);
    ctx.lineTo(L / 2, W / 2 - 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawVehicle(ctx, v, G) {
  const night = G.skyNight;
  if (v.defId === 'boat') {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 3, 30, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f5f7';
    ctx.beginPath();
    ctx.ellipse(0, 0, 29, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = v.color === '#ffffff' ? '#ff2e63' : v.color;
    ctx.beginPath();
    ctx.ellipse(4, 0, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14202e';
    ctx.fillRect(-8, -6, 12, 12);
    ctx.restore();
    return;
  }
  if (v.defId === 'truck') {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(-33 + 3, -13 + 4, 66, 27, 6);
    ctx.fill();
    ctx.fillStyle = v.color;
    ctx.beginPath();
    ctx.roundRect(-33, -13, 66, 27, 6);
    ctx.fill();
    ctx.fillStyle = '#dfe6ee';
    ctx.beginPath();
    ctx.roundRect(14, -11, 17, 23, 4);
    ctx.fill();
    ctx.fillStyle = '#14202e';
    ctx.beginPath();
    ctx.roundRect(16, -8, 8, 17, 2);
    ctx.fill();
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VAULT', -8, 4);
    ctx.fillStyle = '#101014';
    ctx.fillRect(-28, -15, 10, 4);
    ctx.fillRect(8, -15, 10, 4);
    ctx.fillRect(-28, 11, 10, 4);
    ctx.fillRect(8, 11, 10, 4);
    ctx.restore();
    return;
  }
  drawCarBody(ctx, v, night);
  if (v.police) {
    // Light bar, flashing.
    const phase = Math.floor(G.time * 6) % 2 === 0;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.shadowBlur = 12;
    ctx.shadowColor = phase ? '#ff2020' : '#2050ff';
    ctx.fillStyle = phase ? '#ff2020' : '#2050ff';
    ctx.fillRect(-6, -8, 12, 5);
    ctx.fillStyle = phase ? '#2050ff' : '#ff2020';
    ctx.fillRect(-6, 3, 12, 5);
    ctx.restore();
    // Door badge.
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = '#14202e';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('POLICE', 2, 3);
    ctx.restore();
  }
  if (v.dead) {
    // Wreck smoke.
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(G.time * 5 + v.x);
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(v.x, v.y - 6, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
