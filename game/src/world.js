// World simulation for Neon Bay Heat: on-foot player, traffic AI,
// pedestrians, police, wanted system, combat, pickups and effects.
// All original logic; particles live in effects.js.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, damp, angleDiff, angleLerp, makeRng, TAU } from './util.js';
import { VEHICLE_DEFS, createVehicle, updateVehicle, updateBoat, collideVehicles } from './vehicles.js';
import { createEffects } from './effects.js';

export const WEAPONS = [
  { name: 'FISTS', dmg: 20, rate: 0.4, range: 2.2, ammo: Infinity, auto: false },
  { name: 'PISTOL', dmg: 26, rate: 0.32, range: 70, ammo: 60, auto: false },
  { name: 'SMG', dmg: 14, rate: 0.09, range: 55, ammo: 150, auto: true },
  { name: 'SHOTGUN', dmg: 9, rate: 0.85, range: 34, ammo: 28, auto: false, pellets: 6 },
];

const PED_SHIRTS = [0xff5da2, 0x37e0c8, 0xffd166, 0x9dff57, 0x5aa2ff, 0xff7a3d, 0xf2f2f2, 0xc8553d];
const PED_PANTS = [0x2a3444, 0x4a3a2a, 0x3a3a4a, 0x5a2a2a];
const PED_SKINS = [0xe8b98a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0];

// Build a low-poly humanoid (player + pedestrians) from boxes.
function buildHumanoid(shirt, pants, skin) {
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(shirt));
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), mat(skin));
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), mat(0x222222));
  cap.position.y = 1.88;
  g.add(cap);
  const limb = (w, h, d, color, px, py) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const legL = limb(0.22, 0.78, 0.24, pants, -0.16, 0.78);
  const legR = limb(0.22, 0.78, 0.24, pants, 0.16, 0.78);
  const armL = limb(0.18, 0.62, 0.2, shirt, -0.42, 1.44);
  const armR = limb(0.18, 0.62, 0.2, shirt, 0.42, 1.44);
  return { group: g, legL, legR, armL, armR, head, torso };
}

export function createWorld(scene, city, audio, hooks) {
  const rng = makeRng(1337);
  const fx = createEffects(scene);
  const w = {
    scene, city, audio, hooks, fx,
    time: 0,
    cash: 250,
    wanted: 0,
    wantedTimer: 0,
    crimeTimer: 0,
    player: null,
    vehicles: [],
    traffic: [],
    peds: [],
    police: [],
    heli: null,
    roadblocks: [],
    spikes: [],
    spikeTimer: 0,
    pickups: [],
    truck: null,
    bustTimer: 0,
    copShotTimer: 0,
    props: city.props,
  };

  // ---------- player ----------
  // The player's look: pink shirt, dark trousers — easy to spot in a crowd.
  const hParts = buildHumanoid(0xff5da2, 0x2a3444, 0xe8b98a);
  scene.add(hParts.group);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.14, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  );
  gun.position.set(0, -0.62, 0.18);
  hParts.armR.add(gun);
  gun.visible = false;

  w.player = {
    parts: hParts,
    gun,
    pos: new THREE.Vector3(city.playerSpawn.x, 0, city.playerSpawn.z),
    vel: new THREE.Vector3(),
    vy: 0,
    heading: city.playerSpawn.heading,
    onGround: true,
    health: 100,
    armor: 0,
    weapon: 1,
    ammo: [Infinity, 60, 150, 28],
    fireTimer: 0,
    lastHurt: -99,
    walkPhase: 0,
    vehicle: null,
    inBoat: false,
    aimYaw: 0,
  };

  // ---------- vehicles ----------
  function spawnParkedCars() {
    for (const s of city.carSpawns) {
      const v = createVehicle(VEHICLE_DEFS[s.def], s.x, s.z, s.heading);
      v.parked = true;
      scene.add(v.mesh);
      w.vehicles.push(v);
    }
    const starter = createVehicle(VEHICLE_DEFS.supercar, 166, 34, 0);
    scene.add(starter.mesh);
    w.vehicles.push(starter);
    w.starterCar = starter;
    const boat = createVehicle(VEHICLE_DEFS.boat, city.boatSpawn.x, city.boatSpawn.z, city.boatSpawn.heading);
    scene.add(boat.mesh);
    w.vehicles.push(boat);
    w.oceanBoat = boat;
    const basinBoat = createVehicle(VEHICLE_DEFS.boat, city.basinBoatSpawn.x, city.basinBoatSpawn.z, city.basinBoatSpawn.heading);
    scene.add(basinBoat.mesh);
    w.vehicles.push(basinBoat);
    w.basinBoat = basinBoat;
  }
  spawnParkedCars();

  // ---------- traffic ----------
  const LOOPS = [
    [[-120, -120], [40, -120], [40, 40], [-120, 40]],
    [[170, -200], [170, 200], [120, 200], [120, -200]],
    [[-200, -200], [-40, -200], [-40, -40], [-200, -40]],
    [[-40, 40], [120, 40], [120, 200], [-40, 200]],
    [[-200, 120], [120, 120], [120, 200], [-200, 200]],
  ];
  function spawnTraffic() {
    const trafficDefs = ['taxi', 'muscle', 'convertible', 'taxi', 'muscle', 'van'];
    for (let i = 0; i < 12; i += 1) {
      const loop = LOOPS[i % LOOPS.length];
      const start = loop[Math.floor(rng.next() * loop.length)];
      const def = VEHICLE_DEFS[trafficDefs[i % trafficDefs.length]];
      const v = createVehicle(def, start[0] + rng.range(-3, 3), start[1] + rng.range(-3, 3), rng.next() * TAU);
      v.traffic = true;
      v.loop = loop;
      v.wp = Math.floor(rng.next() * loop.length);
      v.cruise = rng.range(9, 14);
      v.stuckT = 0;
      scene.add(v.mesh);
      w.vehicles.push(v);
      w.traffic.push(v);
    }
  }
  spawnTraffic();

  // ---------- pedestrians ----------
  function spawnPeds() {
    for (let i = 0; i < 20; i += 1) {
      const shirt = PED_SHIRTS[i % PED_SHIRTS.length];
      const parts = buildHumanoid(shirt, PED_PANTS[i % PED_PANTS.length], PED_SKINS[i % PED_SKINS.length]);
      scene.add(parts.group);
      const onAvenue = rng.next() < 0.5;
      const p = {
        parts,
        pos: new THREE.Vector3(0, 0, 0),
        heading: rng.next() * TAU,
        speed: rng.range(1.1, 2.0),
        walkPhase: rng.next() * TAU,
        axis: onAvenue ? 'x' : 'z',
        line: 0,
        health: 50,
        dead: false,
        deadT: 0,
        flee: 0,
        state: 'walk',
        riding: false,
      };
      if (onAvenue) {
        const ax = [-200, -120, -40, 40, 120, 170][Math.floor(rng.next() * 6)];
        p.line = ax + (rng.next() < 0.5 ? 10 : -10);
        p.pos.set(p.line, 0, rng.range(-220, 220));
        p.heading = rng.next() < 0.5 ? 0 : Math.PI;
      } else {
        const sz = [-200, -120, -40, 40, 120, 200][Math.floor(rng.next() * 6)];
        p.line = sz + (rng.next() < 0.5 ? 10 : -10);
        p.pos.set(rng.range(-220, 220), 0, p.line);
        p.heading = rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      w.peds.push(p);
    }
  }
  spawnPeds();

  // ---------- pickups ----------
  const pickupDefs = [
    ['health', 150, -60, 0x37e05a], ['armor', 60, -160, 0x5aa2ff],
    ['ammo', -60, 160, 0xffd166], ['cash', 170, 120, 0xffd166],
    ['health', -160, -160, 0x37e05a], ['armor', 120, -40, 0x5aa2ff],
    ['ammo', 40, 200, 0xffd166], ['cash', -200, 40, 0xffd166],
  ];
  for (const [kind, px, pz, color] of pickupDefs) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(px, 1.1, pz);
    scene.add(mesh);
    w.pickups.push({ kind, mesh, x: px, z: pz, taken: false, timer: 0 });
  }

  // ---------- helpers ----------
  w.nearestVehicle = (x, z, maxD, includePolice) => {
    let best = null;
    let bestD = maxD;
    for (const v of w.vehicles) {
      if (v.dead || v.traffic) continue;
      if (v.def.police && !includePolice) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  };

  w.playerPos = () => {
    const p = w.player;
    return p.vehicle ? p.vehicle.pos : p.pos;
  };

  w.isDriving = () => !!w.player.vehicle;

  w.addWanted = (n, cap = 5) => {
    const before = w.wanted;
    w.wanted = clamp(Math.min(cap, w.wanted + n), 0, 5);
    w.crimeTimer = 0;
    if (w.wanted > before && w.hooks.onWanted) w.hooks.onWanted(w.wanted);
  };

  w.hurtPlayer = (dmg) => {
    const p = w.player;
    if (p.health <= 0) return;
    let rest = dmg;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, rest * 0.6);
      p.armor -= absorbed;
      rest -= absorbed;
    }
    p.health -= rest;
    p.lastHurt = w.time;
    if (w.hooks.onHurt) w.hooks.onHurt(p.health);
    if (p.health <= 0) {
      p.health = 0;
      if (w.hooks.onWasted) w.hooks.onWasted();
    }
  };

  w.respawn = (kind) => {
    const p = w.player;
    if (p.vehicle) {
      p.vehicle = null;
      p.inBoat = false;
    }
    const spot = kind === 'busted' ? city.policeStation : city.hospital;
    p.pos.set(spot.x + 16, 0, spot.z);
    p.vel.set(0, 0, 0);
    p.vy = 0;
    p.health = 100;
    p.armor = 0;
    p.parts.group.visible = true;
    w.wanted = 0;
    w.bustTimer = 0;
    for (const c of [...w.police]) w.despawnPoliceCar(c);
    w.police.length = 0;
    if (w.heli) {
      scene.remove(w.heli.group);
      if (w.heli.spot) scene.remove(w.heli.spot);
      w.heli = null;
    }
    for (const rb of w.roadblocks) scene.remove(rb.group);
    w.roadblocks.length = 0;
    for (const sp of w.spikes) scene.remove(sp.group);
    w.spikes.length = 0;
    if (w.hooks.onRespawn) w.hooks.onRespawn(kind);
  };

  // ---------- effects (thin wrappers over the effects module) ----------
  w.spawnPuff = (x, y, z, vx, vy, vz, size, color, life) => fx.spawnPuff(x, y, z, vx, vy, vz, size, color, life);
  w.spawnSparks = (x, y, z, n) => fx.spawnSparks(x, y, z, n);
  w.addSkid = (x1, z1, x2, z2) => fx.addSkid(x1, z1, x2, z2);

  w.explode = (x, y, z, source) => {
    fx.burst(x, y, z, 0xff8a2a, 200);
    audio.explosion();
    const pp = w.playerPos();
    const pd = Math.hypot(pp.x - x, pp.z - z);
    // Your own car blowing up under you is already punished by the ejection
    // damage in killVehicle — the blast itself doesn't also hit you, or a
    // lost car would be an instant death from full health.
    if (pd < 14 && source !== w.player.vehicle) w.hurtPlayer(Math.round(70 * (1 - pd / 14)));
    for (const v of w.vehicles) {
      if (v === source || v.dead) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < 11 && v !== w.player.vehicle) {
        v.health -= 70;
        if (v.truckUnit) v.health = Math.max(v.health, 150);
        if (v.health <= 0 && !v.dead) w.killVehicle(v);
      }
    }
  };

  w.killVehicle = (v) => {
    if (v.dead) return;
    v.dead = true;
    w.explode(v.pos.x, 1, v.pos.z, v);
    if (v.def.police && v.policeUnit) w.addWanted(1);
    if (v === w.truck && w.hooks.onTruckDestroyed) w.hooks.onTruckDestroyed();
    if (v === w.player.vehicle) {
      w.player.vehicle = null;
      w.player.inBoat = false;
      w.player.parts.group.visible = true;
      w.player.pos.set(v.pos.x + 3, 0, v.pos.z + 3);
      w.hurtPlayer(40);
    }
    v.mesh.visible = false;
  };

  w.breakProp = (prop, vx, vz) => {
    if (prop.broken) return;
    prop.broken = true;
    prop.vx = vx;
    prop.vz = vz;
    prop.spin = (Math.random() - 0.5) * 9;
    prop.timer = 20;
    prop.mesh.rotation.x = Math.PI / 2 - 0.2;
    audio.crash(0.25);
  };

  // ---------- police ----------
  w.nearestRoadPoint = (x, z) => {
    const aves = [-200, -120, -40, 40, 120, 170];
    const sts = [-200, -120, -40, 40, 120, 200];
    let best = null;
    let bestD = 1e9;
    for (const ax of aves) {
      const d = Math.abs(x - ax);
      if (d < bestD) { bestD = d; best = { x: ax, z }; }
    }
    for (const sz of sts) {
      const d = Math.abs(z - sz);
      if (d < bestD) { bestD = d; best = { x, z: sz }; }
    }
    return best;
  };

  w.spawnPoliceCar = (x, z) => {
    const v = createVehicle(VEHICLE_DEFS.cruiser, x, z, 0);
    v.policeUnit = true;
    v.stuckT = 0;
    scene.add(v.mesh);
    w.vehicles.push(v);
    w.police.push(v);
    return v;
  };

  w.despawnPoliceCar = (v) => {
    scene.remove(v.mesh);
    const vi = w.vehicles.indexOf(v);
    if (vi >= 0) w.vehicles.splice(vi, 1);
    const pi = w.police.indexOf(v);
    if (pi >= 0) w.police.splice(pi, 1);
  };

  w.spawnHeli = () => {
    const group = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 4.2), mat(0x2a3a5a));
    body.castShadow = true;
    group.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.4), mat(0x2a3a5a));
    tail.position.set(0, 0.3, -3.8);
    group.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), mat(0x111111));
    rotor.position.y = 1.1;
    group.add(rotor);
    const skidM = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 3.4), mat(0x111111));
    skidM.position.y = -1.0;
    group.add(skidM);
    const spot = new THREE.SpotLight(0xfff2c8, 0, 120, 0.32, 0.5, 1.2);
    scene.add(spot);
    scene.add(spot.target);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c8 })));
    scene.add(group);
    const pp = w.playerPos();
    group.position.set(pp.x + 30, 38, pp.z + 20);
    w.heli = { group, rotor, spot, spin: 0 };
  };

  w.spawnRoadblock = () => {
    const pp = w.playerPos();
    const pv = w.player.vehicle;
    const heading = pv ? pv.heading : w.player.heading;
    const fx2 = Math.sin(heading);
    const fz = Math.cos(heading);
    const cx = pp.x + fx2 * 55;
    const cz = pp.z + fz * 55;
    const snap = w.nearestRoadPoint(cx, cz);
    const group = new THREE.Group();
    for (const off of [-4, 4]) {
      const v = createVehicle(VEHICLE_DEFS.cruiser, snap.x + Math.cos(heading) * off, snap.z - Math.sin(heading) * off, heading + Math.PI / 2);
      v.parked = true;
      v.roadblock = true;
      w.vehicles.push(v);
      group.add(v.mesh);
    }
    scene.add(group);
    w.roadblocks.push({ group, x: snap.x, z: snap.z });
  };

  // Spike strip: at 5 stars the NBPD drops one ahead of the player. Driving
  // over it shreds the tires (crippled handling + damage for 6 seconds).
  w.spawnSpikeStrip = () => {
    const pp = w.playerPos();
    const pv = w.player.vehicle;
    const heading = pv ? pv.heading : w.player.heading;
    const cx = pp.x + Math.sin(heading) * 48;
    const cz = pp.z + Math.cos(heading) * 48;
    const snap = w.nearestRoadPoint(clamp(cx, -250, 250), clamp(cz, -250, 250));
    const group = new THREE.Group();
    const baseMat = new THREE.MeshLambertMaterial({ color: 0xd8c21a });
    const base = new THREE.Mesh(new THREE.BoxGeometry(7, 0.18, 1.1), baseMat);
    base.position.y = 0.09;
    group.add(base);
    const spikeMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (let i = -3; i <= 3; i += 1) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 5), spikeMat);
      spike.position.set(i * 1.0, 0.45, 0);
      group.add(spike);
    }
    group.position.set(snap.x, 0, snap.z);
    group.rotation.y = heading;
    scene.add(group);
    w.spikes.push({ group, x: snap.x, z: snap.z, timer: 25 });
  };

  w.spawnTruck = (x, z, heading) => {
    const v = createVehicle(VEHICLE_DEFS.truck, x, z, heading);
    v.truckUnit = true;
    v.loop = null;
    v.wp = 0;
    v.cruise = 12;
    scene.add(v.mesh);
    w.vehicles.push(v);
    w.truck = v;
    return v;
  };

  // ---------- combat ----------
  // Raycast one shot against peds, vehicles and walls; returns the nearest hit.
  function rayHit(origin, d, range) {
    let bestT = range;
    let best = null;
    const test = (tx, tz, ty, radius, obj) => {
      const rx = tx - origin.x;
      const ry = ty - origin.y;
      const rz = tz - origin.z;
      const t = rx * d.x + ry * d.y + rz * d.z;
      if (t < 1 || t > bestT) return;
      const px = origin.x + d.x * t - tx;
      const py = origin.y + d.y * t - ty;
      const pz = origin.z + d.z * t - tz;
      if (px * px + py * py + pz * pz < radius * radius) {
        bestT = t;
        best = { kind: 'target', obj, t };
      }
    };
    for (const ped of w.peds) {
      if (ped.dead) continue;
      test(ped.pos.x, ped.pos.z, 1.1, 1.1, { ped });
    }
    for (const v of w.vehicles) {
      if (v.dead || v === w.player.vehicle) continue;
      test(v.pos.x, v.pos.z, 1.0, v.radius + 0.6, { vehicle: v });
    }
    // Walls: march the ray in 2-unit steps.
    for (let t = 2; t < bestT; t += 2) {
      const wx = origin.x + d.x * t;
      const wz = origin.z + d.z * t;
      const wy = origin.y + d.y * t;
      if (wy < 0 || wy > 90) continue;
      let blocked = false;
      for (const c of city.colliders) {
        if (wx >= c.x0 && wx <= c.x1 && wz >= c.z0 && wz <= c.z1) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        bestT = t;
        best = { kind: 'wall', obj: null, t };
        break;
      }
    }
    return { bestT, best };
  }

  w.shoot = (origin, dir) => {
    const p = w.player;
    if (p.health <= 0) return;
    const wpn = WEAPONS[p.weapon];
    if (p.fireTimer > 0) return;
    if (p.weapon > 0 && p.ammo[p.weapon] <= 0) {
      if (w.hooks.onNoAmmo) w.hooks.onNoAmmo();
      p.fireTimer = 0.3;
      return;
    }
    p.fireTimer = wpn.rate;
    if (p.weapon > 0) p.ammo[p.weapon] -= 1;
    audio.shot();
    const muzzle = (p.vehicle ? p.vehicle.pos : p.pos).clone();
    muzzle.y = 1.45;
    muzzle.addScaledVector(dir, 0.7);
    fx.flash.position.copy(muzzle);
    fx.flash.color.setHex(0xffc37a);
    fx.flash.intensity = 90;
    const pellets = wpn.pellets ?? 1;
    for (let pi = 0; pi < pellets; pi += 1) {
      const d = dir.clone();
      if (pellets > 1 || p.vehicle) {
        const sp = pellets > 1 ? 0.09 : 0.05;
        d.x += (Math.random() - 0.5) * sp;
        d.y += (Math.random() - 0.5) * sp;
        d.z += (Math.random() - 0.5) * sp;
        d.normalize();
      }
      const { bestT, best } = rayHit(origin, d, wpn.range);
      const hitPoint = origin.clone().addScaledVector(d, bestT);
      fx.fireTracer(muzzle, hitPoint);
      if (best && best.kind === 'target' && best.obj) {
        if (best.obj.ped) {
          const ped = best.obj.ped;
          ped.health -= wpn.dmg;
          fx.spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z, 4);
          if (ped.health <= 0) {
            ped.dead = true;
            ped.deadT = 0;
            ped.parts.group.rotation.x = -Math.PI / 2 + 0.15;
            ped.parts.group.position.y = 0.25;
            w.addWanted(1, 3);
            if (w.hooks.onPedDown) w.hooks.onPedDown();
          }
        } else if (best.obj.vehicle) {
          const v = best.obj.vehicle;
          v.health -= wpn.dmg;
          fx.spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z, 6);
          if (v.health <= 0) w.killVehicle(v);
          else if (v.def.police) w.addWanted(1);
          else if (v.traffic) w.addWanted(1);
        }
      } else if (best && best.kind === 'wall') {
        fx.spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z, 3);
      }
    }
  };

  // ---------- per-frame updates ----------
  function updatePlayerOnFoot(dt, input, camYaw) {
    const p = w.player;
    p.fireTimer = Math.max(0, p.fireTimer - dt);
    const f = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    const s = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    const fx2 = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw);
    const rz = Math.sin(camYaw);
    let mx = fx2 * f + rx * s;
    let mz = fz * f + rz * s;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
    }
    const maxSpeed = input.sprint ? 9.5 : 5.5;
    p.vel.x = damp(p.vel.x, mx * maxSpeed, 12, dt);
    p.vel.z = damp(p.vel.z, mz * maxSpeed, 12, dt);
    const oldX = p.pos.x;
    const oldZ = p.pos.z;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    if (city.isWater(p.pos.x, p.pos.z)) {
      p.pos.x = oldX;
      p.pos.z = oldZ;
      p.vel.multiplyScalar(0.2);
    }
    city.collideCircle(p.pos, 0.55);
    if (input.jump && p.onGround) {
      p.vy = 8.2;
      p.onGround = false;
    }
    if (!p.onGround) {
      p.vy -= 24 * dt;
      p.pos.y += p.vy * dt;
      if (p.pos.y <= 0) {
        p.pos.y = 0;
        p.vy = 0;
        p.onGround = true;
      }
    }
    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    if (input.shoot) p.heading = angleLerp(p.heading, camYaw, 1 - Math.exp(-14 * dt));
    else if (hSpeed > 0.5) p.heading = angleLerp(p.heading, Math.atan2(p.vel.x, p.vel.z), 1 - Math.exp(-12 * dt));
    p.walkPhase += hSpeed * dt * 1.7;
    const swing = clamp(hSpeed / 5.5, 0, 1.4) * 0.62;
    const sw = Math.sin(p.walkPhase);
    p.parts.legL.rotation.x = sw * swing;
    p.parts.legR.rotation.x = -sw * swing;
    p.parts.armL.rotation.x = -sw * swing * 0.8;
    p.parts.armR.rotation.x = input.shoot ? -1.35 : sw * swing * 0.8;
    p.parts.group.position.copy(p.pos);
    p.parts.group.rotation.y = p.heading;
    p.gun.visible = p.weapon > 0;
    if (hSpeed > 3.5) {
      for (const prop of city.props) {
        if (prop.broken) continue;
        if (Math.hypot(prop.x - p.pos.x, prop.z - p.pos.z) < 1.0) {
          w.breakProp(prop, p.vel.x * 0.4, p.vel.z * 0.4);
        }
      }
    }
    for (const pk of w.pickups) {
      if (pk.taken) continue;
      if (Math.hypot(pk.x - p.pos.x, pk.z - p.pos.z) < 1.7) {
        pk.taken = true;
        pk.timer = 30;
        pk.mesh.visible = false;
        if (pk.kind === 'health') p.health = Math.min(100, p.health + 50);
        else if (pk.kind === 'armor') p.armor = Math.min(100, p.armor + 50);
        else if (pk.kind === 'ammo') {
          for (let i = 1; i < 4; i += 1) p.ammo[i] = Math.min(WEAPONS[i].ammo * 2, p.ammo[i] + WEAPONS[i].ammo);
        } else if (pk.kind === 'cash') {
          w.cash += 100 + Math.floor(Math.random() * 150);
          audio.cash();
        }
        if (w.hooks.onPickup) w.hooks.onPickup(pk.kind);
      }
    }
    if (w.time - p.lastHurt > 8 && p.health > 0 && p.health < 100) {
      p.health = Math.min(100, p.health + 2.5 * dt);
    }
  }

  function tryEnterExit() {
    const p = w.player;
    if (p.vehicle) {
      const v = p.vehicle;
      if (p.inBoat) {
        let placed = false;
        for (let k = 0; k < 8 && !placed; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          const ex = v.pos.x + Math.sin(a) * 2.8;
          const ez = v.pos.z + Math.cos(a) * 2.8;
          if (!city.isWater(ex, ez)) {
            p.pos.set(ex, 0, ez);
            placed = true;
          }
        }
        if (!placed) p.pos.set(v.pos.x, 0, v.pos.z);
      } else {
        const rx = -Math.cos(v.heading);
        const rz = Math.sin(v.heading);
        p.pos.set(v.pos.x + rx * 2.4, 0, v.pos.z + rz * 2.4);
        if (city.collideCircle(p.pos, 0.6) || city.isWater(p.pos.x, p.pos.z)) {
          p.pos.set(v.pos.x - rx * 2.4, 0, v.pos.z - rz * 2.4);
          city.collideCircle(p.pos, 0.6);
        }
      }
      p.vel.set(0, 0, 0);
      p.vehicle = null;
      p.inBoat = false;
      p.parts.group.visible = true;
      if (w.hooks.onExitVehicle) w.hooks.onExitVehicle();
      return;
    }
    let boat = w.nearestVehicle(p.pos.x, p.pos.z, 4.5, true)
      ?? w.nearestVehicle(p.pos.x, p.pos.z, 4.5, false);
    if (!boat) {
      for (const cand of w.vehicles) {
        if (cand.def.kind !== 'boat' || cand.dead) continue;
        if (Math.hypot(cand.pos.x - p.pos.x, cand.pos.z - p.pos.z) < 4.5) boat = cand;
      }
    }
    if (!boat) return;
    if (boat.parked || boat.traffic || boat.policeUnit || boat.roadblock) {
      w.addWanted(1);
      if (w.hooks.onSteal) w.hooks.onSteal(boat.def.name);
    }
    boat.parked = false;
    boat.traffic = false;
    p.vehicle = boat;
    p.inBoat = boat.def.kind === 'boat';
    p.parts.group.visible = false;
    if (w.hooks.onEnterVehicle) w.hooks.onEnterVehicle(boat.def.name);
  }

  // AI steering: drive toward a target point with speed-aware throttle.
  function driveInputFor(targetX, targetZ, v, cruise, reverseT) {
    const dx = targetX - v.pos.x;
    const dz = targetZ - v.pos.z;
    const desired = Math.atan2(dx, dz);
    const diff = angleDiff(v.heading, desired);
    const steer = clamp(diff * 1.8, -1, 1);
    const dist = Math.hypot(dx, dz);
    let throttle = 1;
    if (Math.abs(diff) > 1.1) throttle = 0.35;
    if (dist < 8) throttle = 0.5;
    if (reverseT > 0) return { throttle: -0.7, steer: -steer, handbrake: false, nitro: false };
    const fwdSpeed = v.vel.x * Math.sin(v.heading) + v.vel.z * Math.cos(v.heading);
    if (fwdSpeed > cruise) throttle = 0;
    return { throttle, steer, handbrake: false, nitro: false };
  }

  function updateTraffic(dt) {
    for (const v of w.traffic) {
      if (v.dead) continue;
      const wp = v.loop[v.wp];
      if (Math.hypot(wp[0] - v.pos.x, wp[1] - v.pos.z) < 7) {
        v.wp = (v.wp + 1) % v.loop.length;
      }
      let blocked = false;
      for (const o of w.vehicles) {
        if (o === v || o.dead) continue;
        const ox = o.pos.x - v.pos.x;
        const oz = o.pos.z - v.pos.z;
        const ahead = ox * Math.sin(v.heading) + oz * Math.cos(v.heading);
        const side = Math.abs(ox * Math.cos(v.heading) - oz * Math.sin(v.heading));
        if (ahead > 0 && ahead < 9 && side < 2.6) { blocked = true; break; }
      }
      const fwdSpeed = v.vel.x * Math.sin(v.heading) + v.vel.z * Math.cos(v.heading);
      let input = driveInputFor(wp[0], wp[1], v, v.cruise, v.reverseT ?? 0);
      if (blocked) input = { throttle: 0, steer: 0, handbrake: false, nitro: false };
      if (fwdSpeed < 0.6 && input.throttle > 0) {
        v.stuckT += dt;
        if (v.stuckT > 2.5) v.reverseT = 0.9;
      } else v.stuckT = 0;
      if (v.reverseT > 0) v.reverseT -= dt;
      updateVehicle(v, input, dt, city, null);
      const pp = w.playerPos();
      if (Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z) > 320 || v.health <= 0) {
        const loop = v.loop;
        const s = loop[Math.floor(Math.random() * loop.length)];
        v.pos.set(s[0], 0, s[1]);
        v.vel.set(0, 0, 0);
        v.health = 100;
        v.dead = false;
        v.mesh.visible = true;
        v.wp = 0;
      }
    }
  }

  function updatePeds(dt) {
    const pp = w.playerPos();
    const pv = w.player.vehicle;
    for (const ped of w.peds) {
      if (ped.riding) continue;
      if (ped.dead) {
        ped.deadT += dt;
        if (ped.deadT > 20) {
          ped.dead = false;
          ped.health = 50;
          ped.parts.group.rotation.x = 0;
          ped.parts.group.position.y = 0;
          ped.pos.set(ped.line, 0, (Math.random() - 0.5) * 400);
          if (ped.axis === 'z') ped.pos.set((Math.random() - 0.5) * 400, 0, ped.line);
        }
        continue;
      }
      let fleeX = 0;
      let fleeZ = 0;
      if (pv) {
        const d = Math.hypot(pv.pos.x - ped.pos.x, pv.pos.z - ped.pos.z);
        if (d < 12 && Math.abs(pv.speed) > 6) {
          ped.flee = 2;
          fleeX = ped.pos.x - pv.pos.x;
          fleeZ = ped.pos.z - pv.pos.z;
        }
      }
      if (ped.flee > 0) {
        ped.flee -= dt;
        const fl = Math.hypot(fleeX, fleeZ) || 1;
        ped.heading = angleLerp(ped.heading, Math.atan2(fleeX / fl, fleeZ / fl), 1 - Math.exp(-8 * dt));
        const sp = ped.speed * 2.6;
        ped.pos.x += Math.sin(ped.heading) * sp * dt;
        ped.pos.z += Math.cos(ped.heading) * sp * dt;
        ped.walkPhase += sp * dt * 2.4;
      } else {
        const sp = ped.speed;
        ped.pos.x += Math.sin(ped.heading) * sp * dt;
        ped.pos.z += Math.cos(ped.heading) * sp * dt;
        ped.walkPhase += sp * dt * 2.2;
        if (Math.abs(ped.pos.x) > 245 || Math.abs(ped.pos.z) > 245) {
          ped.heading += Math.PI;
        }
        if (Math.random() < 0.0009) ped.heading += Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      }
      if (ped.flee <= 0) {
        if (ped.axis === 'x') ped.pos.x = damp(ped.pos.x, ped.line, 4, dt);
        else ped.pos.z = damp(ped.pos.z, ped.line, 4, dt);
      }
      city.collideCircle(ped.pos, 0.5);
      const swing = Math.sin(ped.walkPhase) * 0.5;
      ped.parts.legL.rotation.x = swing;
      ped.parts.legR.rotation.x = -swing;
      ped.parts.armL.rotation.x = -swing * 0.8;
      ped.parts.armR.rotation.x = swing * 0.8;
      ped.parts.group.position.copy(ped.pos);
      ped.parts.group.rotation.y = ped.heading;
      for (const v of w.vehicles) {
        if (v.dead) continue;
        const d = Math.hypot(v.pos.x - ped.pos.x, v.pos.z - ped.pos.z);
        if (d < 1.6 && Math.hypot(v.vel.x, v.vel.z) > 3) {
          ped.dead = true;
          ped.deadT = 0;
          ped.health = 0;
          ped.parts.group.rotation.x = -Math.PI / 2 + 0.15;
          ped.parts.group.position.y = 0.25;
          if (v === w.player.vehicle) {
            w.addWanted(1, 3);
            if (w.hooks.onPedDown) w.hooks.onPedDown();
          }
          audio.crash(0.4);
          break;
        }
      }
    }
  }

  function updatePolice(dt) {
    const pp = w.playerPos();
    const want = w.wanted;
    const targetCount = want === 0 ? 0 : want === 1 ? 1 : want === 2 ? 2 : want === 3 ? 3 : 4;
    if (w.police.length < targetCount) {
      const ang = Math.random() * TAU;
      const tx = pp.x + Math.sin(ang) * 75;
      const tz = pp.z + Math.cos(ang) * 75;
      const snap = w.nearestRoadPoint(clamp(tx, -250, 250), clamp(tz, -250, 250));
      w.spawnPoliceCar(snap.x, snap.z);
    }
    if (w.police.length > targetCount) {
      w.despawnPoliceCar(w.police[w.police.length - 1]);
    }
    for (const c of w.police) {
      if (c.dead) continue;
      if (c.health <= 0) {
        w.killVehicle(c);
        continue;
      }
      const input = driveInputFor(pp.x, pp.z, c, 26, c.reverseT ?? 0);
      const fwdSpeed = c.vel.x * Math.sin(c.heading) + c.vel.z * Math.cos(c.heading);
      if (fwdSpeed < 0.6 && input.throttle > 0) {
        c.stuckT = (c.stuckT ?? 0) + dt;
        if (c.stuckT > 2) c.reverseT = 0.8;
      } else c.stuckT = 0;
      if (c.reverseT > 0) c.reverseT -= dt;
      updateVehicle(c, input, dt, city, (s) => {
        audio.crash(s * 0.7);
        fx.spawnSparks(c.pos.x, 1, c.pos.z, 5);
      });
      const pv = w.player.vehicle;
      if (pv && !pv.def.police) {
        c.ramT = Math.max(0, (c.ramT ?? 0) - dt);
        const d = Math.hypot(c.pos.x - pv.pos.x, c.pos.z - pv.pos.z);
        if (d < 3.4 && c.ramT <= 0 && Math.hypot(c.vel.x - pv.vel.x, c.vel.z - pv.vel.z) > 6) {
          c.ramT = 0.8;
          pv.health -= 6;
          if (pv.health <= 0) w.killVehicle(pv);
        }
      }
    }
    if (want >= 3 && !w.player.vehicle && w.player.health > 0) {
      w.copShotTimer -= dt;
      if (w.copShotTimer <= 0) {
        w.copShotTimer = 1.1;
        const near = w.police.find((c) => !c.dead && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 45);
        if (near) {
          const from = new THREE.Vector3(near.pos.x, 1.4, near.pos.z);
          const to = new THREE.Vector3(pp.x, 1.3, pp.z);
          fx.fireTracer(from, to, 0.08);
          audio.shot();
          if (Math.random() < 0.22) w.hurtPlayer(9);
        }
      }
    }
    if (!w.player.vehicle && want > 0) {
      const near = w.police.find((c) => !c.dead && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 3.6);
      const pSpeed = Math.hypot(w.player.vel.x, w.player.vel.z);
      if (near && pSpeed < 1.5) {
        w.bustTimer += dt;
        if (w.bustTimer > 1.6 && w.hooks.onBusted) w.hooks.onBusted();
      } else {
        w.bustTimer = Math.max(0, w.bustTimer - dt * 2);
      }
    } else w.bustTimer = 0;
    if (want >= 4 && !w.heli) w.spawnHeli();
    if (want < 4 && w.heli) {
      scene.remove(w.heli.group);
      scene.remove(w.heli.spot);
      scene.remove(w.heli.spot.target);
      w.heli = null;
    }
    if (w.heli) {
      const h = w.heli;
      h.spin += dt * 22;
      h.rotor.rotation.y = h.spin;
      const tx = pp.x + 26;
      const tz = pp.z + 18;
      h.group.position.x = damp(h.group.position.x, tx, 1.2, dt);
      h.group.position.z = damp(h.group.position.z, tz, 1.2, dt);
      h.group.position.y = damp(h.group.position.y, 36, 1.2, dt);
      h.spot.position.copy(h.group.position);
      h.spot.target.position.set(pp.x, 0, pp.z);
      h.spot.intensity = 260;
    }
    if (want >= 3 && w.roadblocks.length === 0) w.spawnRoadblock();
    if (want < 3 && w.roadblocks.length > 0) {
      for (const rb of w.roadblocks) scene.remove(rb.group);
      w.vehicles = w.vehicles.filter((v) => !v.roadblock);
      w.roadblocks.length = 0;
    }
    // Spike strips at 5 stars: one ahead of the player every 20s, max 2.
    if (want >= 5 && w.player.vehicle) {
      w.spikeTimer -= dt;
      if (w.spikeTimer <= 0 && w.spikes.length < 2) {
        w.spikeTimer = 20;
        w.spawnSpikeStrip();
      }
    }
    if (want > 0) {
      w.crimeTimer += dt;
      const nearCop = w.police.some((c) => !c.dead && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 45);
      if (w.crimeTimer > 25 && !nearCop) {
        w.wantedTimer += dt;
        if (w.wantedTimer > 12) {
          w.wantedTimer = 0;
          w.wanted = Math.max(0, w.wanted - 1);
        }
      } else w.wantedTimer = 0;
    }
  }

  function updateSpikes(dt) {
    const pv = w.player.vehicle;
    for (let i = w.spikes.length - 1; i >= 0; i -= 1) {
      const sp = w.spikes[i];
      sp.timer -= dt;
      if (sp.timer <= 0) {
        scene.remove(sp.group);
        w.spikes.splice(i, 1);
        continue;
      }
      if (pv && !pv.def.police && pv.spiked <= 0) {
        const d = Math.hypot(pv.pos.x - sp.x, pv.pos.z - sp.z);
        if (d < 2.8) {
          pv.spiked = 6;
          pv.health -= 10;
          audio.crash(0.8);
          fx.spawnSparks(pv.pos.x, 1, pv.pos.z, 10);
          if (w.hooks.onToast) w.hooks.onToast('SPIKE STRIP — tires shredded!');
          if (pv.health <= 0) w.killVehicle(pv);
        }
      }
    }
  }

  function updatePickups(dt) {
    for (const pk of w.pickups) {
      if (pk.taken) {
        pk.timer -= dt;
        if (pk.timer <= 0) {
          pk.taken = false;
          pk.mesh.visible = true;
        }
        continue;
      }
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 1.1 + Math.sin(w.time * 2.4 + pk.x) * 0.18;
    }
  }

  function updateProps(dt) {
    for (const prop of city.props) {
      if (!prop.broken) continue;
      prop.timer -= dt;
      prop.mesh.position.x += prop.vx * dt;
      prop.mesh.position.z += prop.vz * dt;
      prop.mesh.rotation.z += prop.spin * dt;
      prop.vx *= Math.exp(-3 * dt);
      prop.vz *= Math.exp(-3 * dt);
      prop.spin *= Math.exp(-3 * dt);
      if (prop.timer <= 0) {
        prop.broken = false;
        prop.mesh.position.set(prop.x, prop.kind === 'hydrant' ? 0.55 : 0.45, prop.z);
        prop.mesh.rotation.set(0, prop.rotY, 0);
      }
    }
  }

  // ---------- main update ----------
  w.update = (dt, input, camYaw) => {
    w.time += dt;
    const p = w.player;
    if (p.health <= 0) return;
    if (input.enter) tryEnterExit();
    if (input.weapon) {
      p.weapon = clamp(input.weapon - 1, 0, 3);
      p.gun.visible = p.weapon > 0;
    }
    if (p.vehicle) {
      const v = p.vehicle;
      const vin = {
        throttle: (input.f ? 1 : 0) - (input.b ? 1 : 0),
        steer: (input.l ? 1 : 0) - (input.r ? 1 : 0),
        handbrake: !!input.handbrake,
        nitro: !!input.nitro,
      };
      const prevPos = { x: v.pos.x, z: v.pos.z };
      if (v.def.kind === 'boat') updateBoat(v, vin, dt, city, w.time);
      else {
        updateVehicle(v, vin, dt, city, (s) => {
          audio.crash(s);
          fx.spawnSparks(v.pos.x, 1, v.pos.z, Math.round(4 + s * 10));
        });
      }
      if (v.drifting) {
        const bx = Math.sin(v.heading);
        const bz = Math.cos(v.heading);
        const rx = -Math.cos(v.heading);
        const rz = Math.sin(v.heading);
        fx.addSkid(
          v.pos.x - bx * 1.45 - rx * 0.95, v.pos.z - bz * 1.45 - rz * 0.95,
          prevPos.x - bx * 1.45 - rx * 0.95, prevPos.z - bz * 1.45 - rz * 0.95,
        );
        fx.addSkid(
          v.pos.x - bx * 1.45 + rx * 0.95, v.pos.z - bz * 1.45 + rz * 0.95,
          prevPos.x - bx * 1.45 + rx * 0.95, prevPos.z - bz * 1.45 + rz * 0.95,
        );
        if (Math.random() < 0.5) {
          fx.spawnPuff(v.pos.x - bx * 1.6, 0.5, v.pos.z - bz * 1.6, (Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2, 1.2, 0xaaaaaa, 0.8);
        }
      }
      if (v.nitro && Math.random() < 0.4) {
        fx.spawnPuff(v.pos.x - Math.sin(v.heading) * 2.4, 0.7, v.pos.z - Math.cos(v.heading) * 2.4, 0, 1, 0, 0.9, 0x37e0c8, 0.5);
      }
      for (const prop of city.props) {
        if (prop.broken) continue;
        if (Math.hypot(prop.x - v.pos.x, prop.z - v.pos.z) < v.radius * 0.8 + 0.5) {
          w.breakProp(prop, v.vel.x * 0.5, v.vel.z * 0.5);
          v.vel.multiplyScalar(0.92);
        }
      }
      if (v.health <= 0 && !v.dead) w.killVehicle(v);
      p.fireTimer = Math.max(0, p.fireTimer - dt);
      if (input.shoot && input.aimDir) {
        w.shoot(v.pos.clone().setY(1.6), input.aimDir);
      }
    } else {
      updatePlayerOnFoot(dt, input, camYaw);
      if (input.shoot) {
        const dir = input.aimDir;
        if (dir) w.shoot(input.aimOrigin ?? p.pos.clone().setY(1.6), dir);
      }
    }
    for (let i = 0; i < w.vehicles.length; i += 1) {
      const a = w.vehicles[i];
      if (a.dead) continue;
      for (let j = i + 1; j < w.vehicles.length; j += 1) {
        const b = w.vehicles[j];
        if (b.dead) continue;
        if (Math.abs(a.pos.x - b.pos.x) > 6 || Math.abs(a.pos.z - b.pos.z) > 6) continue;
        const rel = Math.hypot(a.vel.x - b.vel.x, a.vel.z - b.vel.z);
        if (collideVehicles(a, b) && rel > 7) {
          audio.crash(clamp(rel / 30, 0.2, 0.9));
          fx.spawnSparks((a.pos.x + b.pos.x) / 2, 1, (a.pos.z + b.pos.z) / 2, 6);
          // Ramming the armored truck is the heist's core move: the truck
          // soaks the hit and the rammer takes only a glancing blow —
          // otherwise no car survives the seven rams needed to stop it.
          const aMul = b.truckUnit ? 0.25 : 1;
          const bMul = a.truckUnit ? 0.25 : 1;
          a.health -= rel * (a.def.heavy ? 0.3 : 0.2) * aMul;
          b.health -= rel * (b.def.heavy ? 0.3 : 0.2) * bMul;
          if (a.truckUnit) a.health = Math.max(a.health, 150);
          if (b.truckUnit) b.health = Math.max(b.health, 150);
          if (a.health <= 0) w.killVehicle(a);
          if (b.health <= 0) w.killVehicle(b);
        }
      }
    }
    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    updateSpikes(dt);
    updatePickups(dt);
    updateProps(dt);
    fx.update(dt);
    if (w.truck && !w.truck.dead && w.truck.loop) {
      const t = w.truck;
      const wp = t.loop[t.wp];
      if (Math.hypot(wp[0] - t.pos.x, wp[1] - t.pos.z) < 8) t.wp = (t.wp + 1) % t.loop.length;
      updateVehicle(t, driveInputFor(wp[0], wp[1], t, t.cruise, 0), dt, city, null);
    }
    const pv = p.vehicle;
    audio.engine(pv ? clamp(Math.abs(pv.speed) / pv.def.topSpeed, 0, 1) : 0, !!(pv && pv.drifting), !!pv);
    audio.siren(w.police.length > 0);
    audio.screech(!!(pv && pv.drifting && Math.abs(pv.speed) > 8));
  };

  return w;
}
