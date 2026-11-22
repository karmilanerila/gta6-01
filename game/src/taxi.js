// Taxi fares: steal a City Cab and the city flags you down. Pick up the
// customer, drop them off before the meter runs out, get paid — plus a tip
// for a fast ride. The fare is the game's most iconic side activity and it
// gives the player a reason to drive a taxi instead of stealing it and
// leaving it. Plain three.js primitives + DOM banners; no assets.
import * as THREE from '../vendor/three.module.min.js';
import { fmtTime } from './util.js';

const FARE_SPOTS = [
  { name: 'Hotel Palma', x: 165, z: -100 },
  { name: 'Port entrance', x: -190, z: 130 },
  { name: 'Hospital', x: -70, z: 80 },
  { name: 'The Park', x: 75, z: 75 },
  { name: 'Downtown', x: -80, z: -80 },
  { name: 'Ocean Beach', x: 185, z: -150 },
];

function makeFareBeacon(color) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 30, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 15;
  group.add(beam);
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color }),
  );
  marker.position.y = 3.4;
  group.add(marker);
  group.visible = false;
  return { group, marker };
}

export function createTaxi(scene, world, city, audio, hooks) {
  const beacon = makeFareBeacon(0xffd166);
  scene.add(beacon.group);
  const t = {
    fare: null, // {phase, ped, dest, timeLeft, timeLimit, amount}
    time: 0,
  };

  function banner(title, sub) {
    if (hooks.onBanner) hooks.onBanner(title, sub);
  }

  function nearestCustomer() {
    const pp = world.playerPos();
    let best = null;
    let bestD = 120;
    for (const ped of world.peds) {
      if (ped.dead || ped.riding) continue;
      const d = Math.hypot(ped.pos.x - pp.x, ped.pos.z - pp.z);
      if (d < bestD) {
        bestD = d;
        best = ped;
      }
    }
    if (best) return best;
    for (const ped of world.peds) {
      if (!ped.dead && !ped.riding) return ped;
    }
    return null;
  }

  function pickDestination(fromX, fromZ) {
    const far = FARE_SPOTS.filter((s) => Math.hypot(s.x - fromX, s.z - fromZ) > 60);
    const list = far.length > 0 ? far : FARE_SPOTS;
    return list[Math.floor(Math.random() * list.length)];
  }

  function dropPed(ped, x, z) {
    if (!ped) return;
    ped.riding = false;
    ped.parts.group.visible = true;
    ped.pos.set(x, 0, z);
    ped.heading = Math.random() * Math.PI * 2;
    ped.parts.group.position.copy(ped.pos);
    ped.parts.group.rotation.y = ped.heading;
  }

  function hideBeacon() {
    beacon.group.visible = false;
  }

  function endFare(msg) {
    if (t.fare && t.fare.ped) dropPed(t.fare.ped, world.playerPos().x + 3, world.playerPos().z + 3);
    t.fare = null;
    hideBeacon();
    // No objective reset needed: main.js falls back from fareText() to the
    // mission/welcome objective on its own when the fare ends.
    if (msg) banner('FARE OVER', msg);
  }

  // Called when the player gets into a City Cab: a customer flags them down.
  t.onEnterTaxi = () => {
    if (t.fare) return;
    const ped = nearestCustomer();
    if (!ped) return;
    t.fare = { phase: 'pickup', ped, dest: null, timeLeft: 0, timeLimit: 0, amount: 0 };
    beacon.group.position.set(ped.pos.x, 0, ped.pos.z);
    beacon.group.visible = true;
    banner('TAXI FARE', 'Pick up the customer — follow the yellow beacon');
    audio.blip();
  };

  // Minimap marker for the current fare target (customer or destination).
  t.getMarkers = () => {
    if (!t.fare) return [];
    if (t.fare.phase === 'pickup' && t.fare.ped) {
      return [{ x: t.fare.ped.pos.x, z: t.fare.ped.pos.z, color: '#ffd166', kind: 'fare' }];
    }
    if (t.fare.dest) {
      return [{ x: t.fare.dest.x, z: t.fare.dest.z, color: '#ffd166', kind: 'fare' }];
    }
    return [];
  };

  // Objective line while a fare is running (main.js shows it when no
  // mission is active).
  t.fareText = () => {
    if (!t.fare) return null;
    if (t.fare.phase === 'pickup') return 'TAXI FARE — pick up the customer';
    return 'TAXI FARE — ' + t.fare.dest.name + '  ·  ' + fmtTime(Math.max(0, t.fare.timeLeft));
  };

  t.update = (dt) => {
    t.time += dt;
    if (!t.fare) return;
    const f = t.fare;
    const p = world.player;
    // Fare ends if the player is out of the taxi or down.
    if (p.health <= 0 || !p.vehicle || p.vehicle.def.name !== 'City Cab') {
      endFare('You left the cab — fare cancelled.');
      return;
    }
    // Beacon follows the customer until they get in, then marks the drop-off.
    if (f.phase === 'pickup' && f.ped) {
      beacon.group.position.set(f.ped.pos.x, 0, f.ped.pos.z);
      beacon.marker.rotation.y += dt * 2.2;
      beacon.marker.position.y = 3.4 + Math.sin(t.time * 2.4) * 0.5;
      const d = Math.hypot(p.vehicle.pos.x - f.ped.pos.x, p.vehicle.pos.z - f.ped.pos.z);
      if (d < 5) {
        // Customer gets in: hide them, pick a destination, start the meter.
        f.ped.riding = true;
        f.ped.parts.group.visible = false;
        f.dest = pickDestination(f.ped.pos.x, f.ped.pos.z);
        const dist = Math.hypot(f.dest.x - f.ped.pos.x, f.dest.z - f.ped.pos.z);
        f.amount = 40 + Math.round(dist * 0.6);
        f.timeLimit = 30 + dist * 0.5;
        f.timeLeft = f.timeLimit;
        f.phase = 'dropoff';
        beacon.group.position.set(f.dest.x, 0, f.dest.z);
        banner('FARE PICKED UP', 'Drop off at ' + f.dest.name + ' — $' + f.amount + ' on the meter');
        audio.cash();
      }
      return;
    }
    if (f.phase === 'dropoff') {
      f.timeLeft -= dt;
      beacon.marker.rotation.y += dt * 2.2;
      beacon.marker.position.y = 3.4 + Math.sin(t.time * 2.4) * 0.5;
      const d = Math.hypot(p.vehicle.pos.x - f.dest.x, p.vehicle.pos.z - f.dest.z);
      if (d < 6) {
        // Delivered: fare + a tip for a fast ride.
        const tip = f.timeLeft > f.timeLimit / 2 ? 25 : 0;
        const total = f.amount + tip;
        world.cash += total;
        audio.cash();
        banner('FARE COMPLETE', '+$' + total + (tip > 0 ? ' — fast ride, $' + tip + ' tip' : ''));
        dropPed(f.ped, f.dest.x + 3, f.dest.z + 3);
        t.fare = null;
        hideBeacon();
        return;
      }
      if (f.timeLeft <= 0) {
        endFare('Too slow — the customer walked away.');
      }
    }
  };

  return t;
}
