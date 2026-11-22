// Missions for Neon Bay Heat: 6 escalating jobs + stunt jumps, all driven
// by beacons and rings in the world. State machine only; rendering is plain
// three.js primitives.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, fmtCash } from './util.js';

const RING_COLOR = 0xff2e88;
const BEACON_COLOR = 0xff5da2;

function makeRingMesh(color) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.4, 10, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.position.y = 3.2;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 26, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 13;
  group.add(beam);
  return group;
}

function makeBeaconMesh(color) {
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
  return { group, marker };
}

export const MISSION_DEFS = [
  {
    id: 'race', name: 'SUNSET SPRINT', desc: 'Street race: hit all 8 rings before the clock runs out.',
    reward: 1500, timeLimit: 150,
    beacon: { x: 170, z: -180 },
    rings: [[170, -120], [170, 0], [170, 120], [120, 120], [40, 120], [-40, 120], [-40, 40], [-40, -40]],
  },
  {
    id: 'getaway', name: 'HOT PURSUIT', desc: 'Lose the heat: hit 3 checkpoints with a 2-star wanted level.',
    reward: 2000, timeLimit: 120,
    beacon: { x: 120, z: -120 },
    rings: [[120, -120], [-40, -120], [-40, -40]],
  },
  {
    id: 'heist', name: 'HARBOR HEIST', desc: 'Stop the armored truck, grab the cash, deliver it to Lena.',
    reward: 3500, timeLimit: 240,
    beacon: { x: -200, z: 120 },
    rings: [],
  },
  {
    id: 'boat', name: "SMUGGLER'S RUN", desc: 'Take the boat from the pier, round 5 buoys, come home.',
    reward: 3000, timeLimit: 210,
    beacon: { x: 196, z: 60 },
    rings: [[228, 0], [242, -80], [232, -160], [246, 120], [228, 180]],
  },
  {
    id: 'trial', name: 'NIGHT SHIFT', desc: 'Downtown time trial: 6 rings, 100 seconds, no excuses.',
    reward: 1200, timeLimit: 100,
    beacon: { x: -120, z: -120 },
    rings: [[-120, -120], [-40, -120], [-40, -40], [-120, -40], [-200, -40], [-200, -120]],
  },
  {
    id: 'neon', name: 'NEON RUN', desc: 'Night delivery: 4 drops across the city, 160 seconds, cops awake.',
    reward: 2200, timeLimit: 160,
    beacon: { x: 170, z: 100 },
    rings: [[120, 200], [-40, 200], [-200, 40], [-120, -200]],
  },
];

const TRUCK_LOOP = [[-200, 120], [-200, -40], [-40, -40], [-40, 120]];
const DROP_OFF = { x: 120, z: 200 };

export function createMissions(scene, world, city, audio, hooks) {
  const m = {
    scene, world, city, audio, hooks,
    defs: MISSION_DEFS,
    done: [],
    active: null,
    beacon: null,
    beaconDef: null,
    rings: [],
    time: 0,
    stunts: [],
    stuntCooldown: {},
  };

  // Stunt jump ramps.
  const rampSpots = [[170, -100], [120, -160], [-40, 200]];
  const rampGeo = new THREE.BoxGeometry(4.5, 0.7, 7);
  const rampMat = new THREE.MeshLambertMaterial({ color: 0xe07b28 });
  const rampMat2 = new THREE.MeshLambertMaterial({ color: 0x222222 });
  for (const [rx, rz] of rampSpots) {
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.position.set(rx, 0.35, rz);
    ramp.rotation.x = -0.32;
    ramp.castShadow = true;
    scene.add(ramp);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 0.8), rampMat2);
    stripe.position.set(rx, 0.75, rz - 2.6);
    stripe.rotation.x = -0.32;
    scene.add(stripe);
    m.stunts.push({ x: rx, z: rz, cooldown: 0 });
  }

  function clearRings() {
    for (const r of m.rings) scene.remove(r.mesh);
    m.rings = [];
  }

  function showRings(points, fromIdx) {
    clearRings();
    points.forEach(([x, z], i) => {
      if (i < fromIdx) return;
      const mesh = makeRingMesh(i === fromIdx ? RING_COLOR : 0x37e0c8);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      m.rings.push({ mesh, x, z, passed: false });
    });
  }

  function setBeacon(def) {
    m.clearBeacon();
    if (!def) return;
    const built = makeBeaconMesh(BEACON_COLOR);
    built.group.position.set(def.beacon.x, 0, def.beacon.z);
    scene.add(built.group);
    m.beacon = { group: built.group, marker: built.marker };
    m.beaconDef = def;
  }

  m.clearBeacon = () => {
    if (m.beacon) {
      scene.remove(m.beacon.group);
      m.beacon = null;
      m.beaconDef = null;
    }
  };

  m.nextDef = () => m.defs.find((d) => !m.done.includes(d.id)) ?? null;

  m.refreshBeacon = () => {
    if (m.active) {
      m.clearBeacon();
      return;
    }
    setBeacon(m.nextDef());
  };

  function banner(title, sub) {
    if (hooks.onBanner) hooks.onBanner(title, sub);
  }

  function objective(text) {
    if (hooks.onObjective) hooks.onObjective(text);
  }

  function failMission(reason) {
    if (!m.active) return;
    const def = m.active.def;
    clearRings();
    m.active = null;
    audio.blip();
    banner('MISSION FAILED', reason);
    if (hooks.onMissionFailed) hooks.onMissionFailed(def.id, reason);
    m.refreshBeacon();
  }

  function completeMission() {
    const a = m.active;
    if (!a) return;
    const def = a.def;
    m.done.push(def.id);
    world.cash += def.reward;
    audio.missionDone();
    audio.cash();
    banner('MISSION PASSED', def.name + '  ·  +' + fmtCash(def.reward));
    if (hooks.onMissionComplete) hooks.onMissionComplete(def.id, def.reward);
    clearRings();
    m.active = null;
    m.refreshBeacon();
  }

  function startMission(def) {
    m.clearBeacon();
    const a = { def, stage: 0, ringIdx: 0, timeLeft: def.timeLimit, truck: null, collected: false };
    m.active = a;
    audio.blip();
    if (def.id === 'race' || def.id === 'trial' || def.id === 'boat' || def.id === 'neon') {
      showRings(def.rings, 0);
      objective(def.name + ': ring ' + 1 + ' of ' + def.rings.length);
    } else if (def.id === 'getaway') {
      world.wanted = 2;
      world.crimeTimer = 0;
      showRings(def.rings, 0);
      objective(def.name + ': checkpoint 1 of ' + def.rings.length + ' — stay ahead of the law');
    } else if (def.id === 'heist') {
      const truck = world.spawnTruck(-200, 120, Math.PI);
      truck.loop = TRUCK_LOOP;
      truck.wp = 0;
      a.truck = truck;
      objective(def.name + ': stop the armored truck');
    }
    banner(def.name, def.desc);
    if (hooks.onMissionStart) hooks.onMissionStart(def.id);
  }

  m.update = (dt) => {
    m.time += dt;
    if (m.beacon) {
      m.beacon.marker.rotation.y += dt * 2.2;
      m.beacon.marker.position.y = 3.4 + Math.sin(m.time * 2.4) * 0.5;
      const pp = world.playerPos();
      const bd = Math.hypot(pp.x - m.beaconDef.beacon.x, pp.z - m.beaconDef.beacon.z);
      if (bd < 6) startMission(m.beaconDef);
    }
    for (const r of m.rings) r.mesh.rotation.y += dt * 0.5;
    const pv = world.player.vehicle;
    for (const s of m.stunts) {
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (!pv || s.cooldown > 0) continue;
      const d = Math.hypot(pv.pos.x - s.x, pv.pos.z - s.z);
      if (d < 3.5 && Math.abs(pv.speed) > 22) {
        s.cooldown = 15;
        pv.airT = 0.9;
        world.cash += 250;
        audio.cash();
        banner('STUNT JUMP', '+$250 — nice air');
        if (hooks.onStunt) hooks.onStunt();
      }
    }
    const a = m.active;
    if (!a) return;
    a.timeLeft -= dt;
    if (a.timeLeft <= 0) {
      failMission('Out of time.');
      return;
    }
    // One warning when the clock gets short — a missed deadline is the
    // most common way to lose a job.
    if (a.timeLeft <= 10 && !a.warned) {
      a.warned = true;
      banner('HURRY', '10 seconds left on ' + a.def.name);
      audio.blip();
    }
    const pp = world.playerPos();
    if (a.def.id === 'race' || a.def.id === 'trial' || a.def.id === 'boat' || a.def.id === 'getaway' || a.def.id === 'neon') {
      const ring = m.rings[0];
      if (ring) {
        const d = Math.hypot(pp.x - ring.x, pp.z - ring.z);
        if (d < 5.5) {
          a.ringIdx += 1;
          audio.cash();
          const def = a.def;
          if (a.ringIdx >= def.rings.length) {
            completeMission();
            return;
          }
          showRings(def.rings, a.ringIdx);
          objective(def.name + ': ring ' + (a.ringIdx + 1) + ' of ' + def.rings.length);
        }
      }
      if (a.def.id === 'boat' && !world.player.inBoat && a.ringIdx > 0) {
        a.boatGrace = (a.boatGrace ?? 0) + dt;
        if (a.boatGrace > 10) failMission('You lost the boat.');
      } else a.boatGrace = 0;
    } else if (a.def.id === 'heist') {
      const t = a.truck;
      if (!t || t.dead) {
        failMission('The truck was destroyed.');
        return;
      }
      if (a.stage === 0) {
        if (t.health <= 150) {
          t.loop = null;
          t.cruise = 0;
          a.stage = 1;
          objective('HEIST: grab the cash from the truck (get close)');
          banner('TRUCK STOPPED', 'Grab the cash');
        } else {
          objective('HEIST: stop the truck — ' + Math.max(0, Math.round(t.health)) + ' HP');
        }
      } else if (a.stage === 1) {
        const d = Math.hypot(pp.x - t.pos.x, pp.z - t.pos.z);
        if (d < 5 && !world.player.vehicle) {
          a.collected = true;
          a.stage = 2;
          world.wanted = Math.max(world.wanted, 3);
          world.crimeTimer = 0;
          const mesh = makeRingMesh(0xffd166);
          mesh.position.set(DROP_OFF.x, 0, DROP_OFF.z);
          scene.add(mesh);
          m.rings.push({ mesh, x: DROP_OFF.x, z: DROP_OFF.z, passed: false });
          objective('HEIST: deliver the cash to Lena at the drop-off');
          banner('CASH GRABBED', 'Lose the cops, reach the drop-off');
        } else if (d < 5) {
          objective('HEIST: get out of the car to grab the cash');
        }
      } else if (a.stage === 2) {
        const d = Math.hypot(pp.x - DROP_OFF.x, pp.z - DROP_OFF.z);
        if (d < 6) {
          world.truck = null;
          const vi = world.vehicles.indexOf(t);
          if (vi >= 0) world.vehicles.splice(vi, 1);
          scene.remove(t.mesh);
          completeMission();
          return;
        }
      }
    }
    if (hooks.onMissionTick) hooks.onMissionTick(a.timeLeft, a.def);
  };

  m.getMarkers = () => {
    const out = [];
    if (m.beaconDef) out.push({ x: m.beaconDef.beacon.x, z: m.beaconDef.beacon.z, color: '#ff5da2', kind: 'mission' });
    for (const r of m.rings) out.push({ x: r.x, z: r.z, color: '#ff2e88', kind: 'ring' });
    return out;
  };

  m.loadDone = (ids) => {
    m.done = ids.filter((id) => m.defs.some((d) => d.id === id));
    m.refreshBeacon();
  };

  // Staging helper for screenshots: start a mission immediately.
  m.debugStart = (id) => {
    const def = m.defs.find((d) => d.id === id);
    if (def) startMission(def);
  };

  m.refreshBeacon();
  return m;
}
