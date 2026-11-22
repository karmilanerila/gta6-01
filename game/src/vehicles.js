// Arcade vehicle physics + low-poly vehicle meshes for Neon Bay Heat.
// Each vehicle is one merged vertex-coloured mesh (one draw call per car);
// police light bars are the only extra meshes. No external assets.
//
// Part format: [w, h, d, x, y, z, color, ry?] — a box at (x, y, z) with an
// optional yaw. Keeping parts as plain arrays makes the mesh table compact
// and the merge loop trivial.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, damp } from './util.js';

export const VEHICLE_DEFS = {
  supercar: {
    name: 'Comet S', kind: 'car', topSpeed: 62, accel: 30, brake: 42, grip: 9,
    turn: 2.1, color: 0xff2e88, nitro: true, seats: 2,
  },
  muscle: {
    name: 'Sabre GT', kind: 'car', topSpeed: 53, accel: 25, brake: 38, grip: 7,
    turn: 1.9, color: 0xff7a1a, nitro: true, seats: 2,
  },
  convertible: {
    name: 'Sunset Spyder', kind: 'car', topSpeed: 58, accel: 28, brake: 40, grip: 8.5,
    turn: 2.2, color: 0x2ee8ff, nitro: true, seats: 2, openTop: true,
  },
  van: {
    name: 'Bay Runner', kind: 'car', topSpeed: 44, accel: 18, brake: 34, grip: 8,
    turn: 1.6, color: 0x9dff57, nitro: false, seats: 2, heavy: true, health: 160,
  },
  taxi: {
    name: 'City Cab', kind: 'car', topSpeed: 45, accel: 19, brake: 36, grip: 8,
    turn: 1.8, color: 0xffc21a, nitro: false, seats: 2,
  },
  cruiser: {
    name: 'Interceptor', kind: 'car', topSpeed: 57, accel: 27, brake: 44, grip: 9.5,
    turn: 2.2, color: 0xf2f2f2, nitro: false, seats: 2, police: true,
  },
  truck: {
    name: 'Armored Truck', kind: 'car', topSpeed: 34, accel: 13, brake: 30, grip: 8,
    turn: 1.3, color: 0x5a6a72, nitro: false, seats: 2, heavy: true, health: 300,
  },
  boat: {
    name: 'Cigarette 38', kind: 'boat', topSpeed: 48, accel: 20, brake: 22, grip: 4,
    turn: 2.1, color: 0xffffff, nitro: false, seats: 2,
  },
};

const DARK = 0x14181f;
const TYRE = 0x0c0c0c;
const LAMP_F = 0xfff6cf;
const LAMP_R = 0xff2222;

// Merge coloured boxes into a single vertex-coloured geometry.
function mergeBoxes(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const col = new THREE.Color();
  let base = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (const p of parts) {
    const [w, h, d, x, y, z, color, ry] = p;
    const geo = new THREE.BoxGeometry(w, h, d);
    eul.set(0, ry ?? 0, 0);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(x, y, z), q, one);
    geo.applyMatrix4(m4);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const idx = geo.index;
    col.setHex(color);
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(col.r, col.g, col.b);
    }
    for (let i = 0; i < idx.count; i += 1) indices.push(idx.getX(i) + base);
    base += pos.count;
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });

// Standard car body: slab + cabin + 4 wheels + lights. Extras per def below.
function carParts(def) {
  const c = def.color;
  const cabin = def.police ? 0x181c22 : DARK;
  const parts = [
    [2.0, 0.62, 4.4, 0, 0.58, 0, c],
    [1.7, 0.55, 2.1, 0, 1.12, -0.25, cabin],
    [0.34, 0.66, 0.95, -0.95, 0.33, 1.45, TYRE],
    [0.34, 0.66, 0.95, 0.95, 0.33, 1.45, TYRE],
    [0.34, 0.66, 0.95, -0.95, 0.33, -1.45, TYRE],
    [0.34, 0.66, 0.95, 0.95, 0.33, -1.45, TYRE],
    [0.34, 0.14, 0.08, -0.6, 0.62, 2.21, LAMP_F],
    [0.34, 0.14, 0.08, 0.6, 0.62, 2.21, LAMP_F],
    [0.34, 0.14, 0.08, -0.6, 0.62, -2.21, LAMP_R],
    [0.34, 0.14, 0.08, 0.6, 0.62, -2.21, LAMP_R],
  ];
  if (def === VEHICLE_DEFS.supercar) {
    parts.push(
      [1.9, 0.09, 0.42, 0, 1.05, -2.05, 0x111111],
      [0.1, 0.28, 0.3, -0.8, 0.9, -2.05, 0x111111],
      [0.1, 0.28, 0.3, 0.8, 0.9, -2.05, 0x111111],
    );
  }
  if (def === VEHICLE_DEFS.convertible) {
    // Open top: no cabin box, low windscreen + roll bar instead.
    parts[1] = [1.7, 0.18, 2.0, 0, 0.95, -0.25, DARK];
    parts.push(
      [1.6, 0.5, 0.12, 0, 1.15, 0.75, 0x9fe8ff],
      [1.6, 0.14, 0.14, 0, 1.28, -1.2, 0x222222],
      [1.5, 0.4, 1.4, 0, 0.95, -0.4, 0x333333],
    );
  }
  if (def === VEHICLE_DEFS.van) {
    parts.length = 0;
    parts.push(
      [2.2, 0.7, 4.8, 0, 0.6, 0, c],
      [2.1, 1.3, 3.4, 0, 1.5, -0.5, c],
      [2.12, 0.5, 3.42, 0, 1.05, -0.5, 0x2c353b],
      [1.9, 0.7, 0.1, 0, 1.5, 1.25, 0x9fe8ff],
      [0.36, 0.7, 1.0, -1.0, 0.35, 1.5, TYRE],
      [0.36, 0.7, 1.0, 1.0, 0.35, 1.5, TYRE],
      [0.36, 0.7, 1.0, -1.0, 0.35, -1.5, TYRE],
      [0.36, 0.7, 1.0, 1.0, 0.35, -1.5, TYRE],
      [0.36, 0.15, 0.08, -0.65, 0.65, 2.41, LAMP_F],
      [0.36, 0.15, 0.08, 0.65, 0.65, 2.41, LAMP_F],
      [0.36, 0.15, 0.08, -0.65, 0.65, -2.41, LAMP_R],
      [0.36, 0.15, 0.08, 0.65, 0.65, -2.41, LAMP_R],
    );
  }
  if (def === VEHICLE_DEFS.taxi) {
    parts.push([0.9, 0.22, 0.5, 0, 1.5, -0.25, 0xfff2b0]);
  }
  if (def === VEHICLE_DEFS.truck) {
    parts.length = 0;
    parts.push(
      [2.6, 1.1, 2.0, 0, 0.85, 2.2, 0x3a464e],
      [2.6, 2.4, 4.6, 0, 1.9, -0.8, 0x5a6a72],
      [2.62, 0.5, 4.62, 0, 0.95, -0.8, 0x2c353b],
      [0.4, 0.8, 1.1, -1.15, 0.4, 2.6, TYRE],
      [0.4, 0.8, 1.1, 1.15, 0.4, 2.6, TYRE],
      [0.4, 0.8, 1.1, -1.15, 0.4, -2.6, TYRE],
      [0.4, 0.8, 1.1, 1.15, 0.4, -2.6, TYRE],
      [0.4, 0.16, 0.08, -0.7, 0.85, 3.21, LAMP_F],
      [0.4, 0.16, 0.08, 0.7, 0.85, 3.21, LAMP_F],
      [0.4, 0.16, 0.08, -0.7, 0.85, -3.11, LAMP_R],
      [0.4, 0.16, 0.08, 0.7, 0.85, -3.11, LAMP_R],
    );
  }
  return parts;
}

export function buildCarMesh(def) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(mergeBoxes(carParts(def)), bodyMat);
  body.castShadow = true;
  group.add(body);
  let lightBar = null;
  if (def.police) {
    lightBar = {
      red: new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2222 })),
      blue: new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshBasicMaterial({ color: 0x2266ff })),
    };
    lightBar.red.position.set(-0.32, 1.48, -0.25);
    lightBar.blue.position.set(0.32, 1.48, -0.25);
    group.add(lightBar.red);
    group.add(lightBar.blue);
  }
  return { group, lightBar };
}

export function buildBoatMesh(def) {
  const parts = [
    [2.4, 0.7, 7.5, 0, 0.55, 0, def.color],
    [2.0, 0.5, 2.2, 0, 1.05, -0.6, 0x18222e],
    [2.42, 0.18, 7.52, 0, 0.95, 0, 0xff2e88],
    [0.5, 0.9, 0.5, -0.7, 1.2, -3.4, 0x222222],
    [0.5, 0.9, 0.5, 0.7, 1.2, -3.4, 0x222222],
  ];
  const group = new THREE.Group();
  const body = new THREE.Mesh(mergeBoxes(parts), bodyMat);
  body.castShadow = true;
  group.add(body);
  return { group, lightBar: null };
}

export function createVehicle(def, x, z, heading) {
  const built = def.kind === 'boat' ? buildBoatMesh(def) : buildCarMesh(def);
  const v = {
    def,
    mesh: built.group,
    lightBar: built.lightBar,
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    heading,
    speed: 0,
    steerVis: 0,
    accelVis: 0,
    drifting: false,
    nitro: false,
    nitroFuel: 100,
    health: def.health ?? 100,
    dead: false,
    radius: def === VEHICLE_DEFS.truck ? 2.4 : def === VEHICLE_DEFS.van ? 2.0 : 1.7,
    smokeT: 0,
    flashT: 0,
    spiked: 0, // spike-strip timer: steering + top speed crippled while > 0
  };
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = heading;
  return v;
}

function syncMesh(v) {
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  // Body roll/pitch: lean into turns, squat on accel.
  const lat = v.vel.x * Math.cos(v.heading) - v.vel.z * Math.sin(v.heading);
  v.mesh.rotation.z = clamp(-lat * 0.012, -0.09, 0.09);
  v.mesh.rotation.x = clamp(-v.accelVis * 0.004, -0.03, 0.05);
}

export function updateVehicle(v, input, dt, city, onCrash) {
  const def = v.def;
  const fwdX = Math.sin(v.heading);
  const fwdZ = Math.cos(v.heading);
  const fwdSpeed = v.vel.x * fwdX + v.vel.z * fwdZ;
  v.speed = fwdSpeed;
  const speed01 = clamp(Math.abs(fwdSpeed) / def.topSpeed, 0, 1);

  // Spike strips: crippled handling for a few seconds.
  if (v.spiked > 0) v.spiked -= dt;

  // Nitro.
  const wantNitro = input.nitro && def.nitro && v.nitroFuel > 0 && fwdSpeed > 5 && v.spiked <= 0;
  v.nitro = wantNitro;
  if (wantNitro) v.nitroFuel = Math.max(0, v.nitroFuel - 30 * dt);
  else v.nitroFuel = Math.min(100, v.nitroFuel + 6 * dt);

  // Engine / brake.
  let engine = 0;
  if (input.throttle > 0) engine = def.accel * input.throttle;
  else if (input.throttle < 0) {
    engine = fwdSpeed > 1 ? -def.brake : def.accel * 0.55 * input.throttle;
  }
  if (wantNitro) engine *= 1.8;
  if (v.spiked > 0) engine *= 0.45;
  const maxSpeed = def.topSpeed * (wantNitro ? 1.28 : 1) * (v.spiked > 0 ? 0.55 : 1);
  v.vel.x += fwdX * engine * dt;
  v.vel.z += fwdZ * engine * dt;

  // Drag + rolling resistance.
  const drag = 0.35 + speed01 * 0.55;
  v.vel.multiplyScalar(Math.exp(-drag * dt * 0.6));
  if (input.throttle === 0) v.vel.multiplyScalar(Math.exp(-1.1 * dt));

  // Steering.
  const steerTarget = clamp(input.steer, -1, 1);
  v.steerVis = damp(v.steerVis, steerTarget, 10, dt);
  const grip = input.handbrake ? 2.0 : def.grip;
  const turnAuthority = clamp(Math.abs(fwdSpeed) / 8, 0, 1) * (fwdSpeed >= 0 ? 1 : -1);
  const turnRate = v.steerVis * def.turn * (1 - speed01 * 0.45) * turnAuthority * (v.spiked > 0 ? 0.6 : 1);
  v.heading += turnRate * dt * (input.handbrake ? 1.5 : 1);

  // Lateral grip: velocity follows heading, loosely while drifting.
  const nfwdX = Math.sin(v.heading);
  const nfwdZ = Math.cos(v.heading);
  const f2 = v.vel.x * nfwdX + v.vel.z * nfwdZ;
  let lx = v.vel.x - nfwdX * f2;
  let lz = v.vel.z - nfwdZ * f2;
  const latDamp = Math.exp(-grip * dt);
  lx *= latDamp;
  lz *= latDamp;
  v.vel.x = nfwdX * f2 + lx;
  v.vel.z = nfwdZ * f2 + lz;
  v.drifting = input.handbrake && Math.abs(fwdSpeed) > 10;

  // Cap speed.
  const sp = Math.hypot(v.vel.x, v.vel.z);
  if (sp > maxSpeed) v.vel.multiplyScalar(maxSpeed / sp);
  if (sp < 0.05 && input.throttle === 0) v.vel.set(0, 0, 0);

  // Integrate + collide.
  const oldX = v.pos.x;
  const oldZ = v.pos.z;
  v.pos.x += v.vel.x * dt;
  v.pos.z += v.vel.z * dt;
  let crashed = false;
  if (city.isWater(v.pos.x, v.pos.z)) {
    v.pos.x = oldX;
    v.pos.z = oldZ;
    v.vel.multiplyScalar(-0.25);
    crashed = true;
  } else if (city.collideCircle(v.pos, v.radius)) {
    // Kill velocity into the wall, keep the sliding component.
    const nx = v.pos.x - oldX;
    const nz = v.pos.z - oldZ;
    const nl = Math.hypot(nx, nz) || 1;
    const into = (v.vel.x * nx + v.vel.z * nz) / nl;
    if (into < 0) {
      v.vel.x -= (nx / nl) * into;
      v.vel.z -= (nz / nl) * into;
      v.vel.multiplyScalar(0.55);
    }
    crashed = true;
  }
  // Crash damage + sound only on the impact itself (rising edge), so sliding
  // along a wall doesn't drain the whole health bar in a second.
  const wasCrashed = v._wasCrashed ?? false;
  v._wasCrashed = crashed;
  if (crashed && !wasCrashed) {
    if (sp > 6 && onCrash) onCrash(clamp(sp / 40, 0.15, 1));
    if (sp > 12) {
      // A hard hit costs health, but a few scrapes shouldn't total the car.
      v.health -= (sp - 12) * 0.4;
      if (v.truckUnit) v.health = Math.max(v.health, 150);
    }
  }
  v.accelVis = engine;
  v.flashT = Math.max(0, (v.flashT ?? 0) - dt);
  if (v.lightBar) {
    const phase = Math.floor(performance.now() / 180) % 2 === 0;
    v.lightBar.red.visible = phase;
    v.lightBar.blue.visible = !phase;
  }
  syncMesh(v);
}

export function updateBoat(v, input, dt, city, time) {
  const def = v.def;
  const fwdX = Math.sin(v.heading);
  const fwdZ = Math.cos(v.heading);
  const fwdSpeed = v.vel.x * fwdX + v.vel.z * fwdZ;
  v.speed = fwdSpeed;
  let engine = 0;
  if (input.throttle > 0) engine = def.accel;
  else if (input.throttle < 0) engine = fwdSpeed > 1 ? -def.brake : -def.accel * 0.5;
  v.vel.x += fwdX * engine * dt;
  v.vel.z += fwdZ * engine * dt;
  v.vel.multiplyScalar(Math.exp(-0.55 * dt));
  const turnAuthority = clamp(Math.abs(fwdSpeed) / 4, 0, 1) * (fwdSpeed >= 0 ? 1 : -1);
  v.heading += clamp(input.steer, -1, 1) * def.turn * 0.9 * turnAuthority * dt;
  const nfwdX = Math.sin(v.heading);
  const nfwdZ = Math.cos(v.heading);
  const f2 = v.vel.x * nfwdX + v.vel.z * nfwdZ;
  let lx = v.vel.x - nfwdX * f2;
  let lz = v.vel.z - nfwdZ * f2;
  const latDamp = Math.exp(-def.grip * dt);
  v.vel.x = nfwdX * f2 + lx * latDamp;
  v.vel.z = nfwdZ * f2 + lz * latDamp;
  const sp = Math.hypot(v.vel.x, v.vel.z);
  if (sp > def.topSpeed) v.vel.multiplyScalar(def.topSpeed / sp);
  const oldX = v.pos.x;
  const oldZ = v.pos.z;
  v.pos.x += v.vel.x * dt;
  v.pos.z += v.vel.z * dt;
  // Boats stay in water; bounce off the shore / docks.
  if (!city.isWater(v.pos.x, v.pos.z) || city.collideCircle(v.pos, 2.0)) {
    v.pos.x = oldX;
    v.pos.z = oldZ;
    v.vel.multiplyScalar(-0.3);
  }
  v.pos.y = Math.sin(time * 1.7) * 0.14 + Math.sin(time * 2.9 + 1.3) * 0.07;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  v.mesh.rotation.z = clamp(-v.steerVis * 0.05, -0.08, 0.08) + Math.sin(time * 1.3) * 0.02;
  v.steerVis = damp(v.steerVis, clamp(input.steer, -1, 1), 8, dt);
}

// Circle-vs-circle push between two vehicles; returns true if they touched.
export function collideVehicles(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r || d2 < 0.0001) return false;
  const d = Math.sqrt(d2);
  const push = (r - d) / 2;
  const nx = dx / d;
  const nz = dz / d;
  const aHeavy = a.def.heavy ? 0.15 : 1;
  const bHeavy = b.def.heavy ? 0.15 : 1;
  a.pos.x -= nx * push * bHeavy;
  a.pos.z -= nz * push * bHeavy;
  b.pos.x += nx * push * aHeavy;
  b.pos.z += nz * push * aHeavy;
  // Exchange a bit of velocity along the normal.
  const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
  if (rel < 0) {
    const imp = -rel * 0.6;
    a.vel.x -= nx * imp * bHeavy;
    a.vel.z -= nz * imp * bHeavy;
    b.vel.x += nx * imp * aHeavy;
    b.vel.z += nz * imp * aHeavy;
  }
  return true;
}

export function kmh(v) {
  return Math.abs(v.speed) * 3.6;
}
