// Sunset Keys — six missions: a race, a delivery, a getaway, a heist, a boat run
// and a neon trial. Each is a small state machine with clear objectives and a payout.
// Written fresh for round 5.
import { clamp, dist, fmtCash } from './util.js';
import { makeVehicle } from './vehicles.js';
import { addWanted } from './police.js';

export const MISSIONS = [
  {
    id: 'sprint', name: 'Sunset Sprint', payout: 1800,
    desc: 'Race through 5 checkpoints across the Keys before the clock runs out.',
    start: { x: 1200, y: 1200 },
    time: 150,
    stages: [
      { kind: 'goto', x: 400, y: 300, r: 70, text: 'Checkpoint 1/5 — North Gate' },
      { kind: 'goto', x: 2800, y: 300, r: 70, text: 'Checkpoint 2/5 — East Highway' },
      { kind: 'goto', x: 2800, y: 2100, r: 70, text: 'Checkpoint 3/5 — South Beach' },
      { kind: 'goto', x: 400, y: 2100, r: 70, text: 'Checkpoint 4/5 — Marina Bend' },
      { kind: 'goto', x: 1600, y: 1200, r: 70, text: 'Finish — Downtown Plaza' },
    ],
  },
  {
    id: 'delivery', name: 'Pier Run', payout: 1500,
    desc: 'Pick up the parcel at the marina and run it to the end of the pier. Fast.',
    start: { x: 2960, y: 2180 },
    time: 110,
    stages: [
      { kind: 'goto', x: 2960, y: 2180, r: 70, text: 'Pick up the parcel at the marina' },
      { kind: 'goto', x: 3480, y: 1200, r: 70, text: 'Deliver it to the end of the pier' },
    ],
  },
  {
    id: 'getaway', name: 'Clean Getaway', payout: 2000,
    desc: 'The patrol is on you. Stay free for 45 seconds, then vanish at the safehouse.',
    start: { x: 1600, y: 900 },
    time: 0,
    stages: [
      { kind: 'survive', seconds: 45, text: 'Stay free — lose the patrol' },
      { kind: 'goto', x: 900, y: 300, r: 80, text: 'Reach the safehouse' },
    ],
  },
  {
    id: 'heist', name: 'Vault Truck', payout: 3500,
    desc: 'Ram the armored truck until its vault pops, then grab the cash.',
    start: { x: 2000, y: 300 },
    time: 0,
    stages: [
      { kind: 'ram', text: 'Ram the Vault Truck until it stops' },
      { kind: 'collect', r: 70, text: 'Grab the cash from the truck' },
    ],
  },
  {
    id: 'boat', name: 'Island Hop', payout: 2800,
    desc: 'Take the runabout from the marina dock, round all four buoys, come home.',
    start: { x: 3300, y: 1850 },
    time: 180,
    stages: [
      { kind: 'goto', x: 3400, y: 900, r: 80, text: 'Buoy 1/4 — North Reach', boat: true },
      { kind: 'goto', x: 3520, y: 1400, r: 80, text: 'Buoy 2/4 — East Point', boat: true },
      { kind: 'goto', x: 3380, y: 1950, r: 80, text: 'Buoy 3/4 — South Shoal', boat: true },
      { kind: 'goto', x: 3480, y: 500, r: 80, text: 'Buoy 4/4 — Coral Head', boat: true },
      { kind: 'goto', x: 3300, y: 1850, r: 80, text: 'Back to the marina dock', boat: true },
    ],
  },
  {
    id: 'neon', name: 'Neon Gates', payout: 2200,
    desc: 'Thread eight neon gates through downtown before the timer dies.',
    start: { x: 1200, y: 900 },
    time: 120,
    stages: [
      { kind: 'goto', x: 1200, y: 900, r: 60, text: 'Gate 1/8' },
      { kind: 'goto', x: 1600, y: 900, r: 60, text: 'Gate 2/8' },
      { kind: 'goto', x: 2000, y: 900, r: 60, text: 'Gate 3/8' },
      { kind: 'goto', x: 2000, y: 1200, r: 60, text: 'Gate 4/8' },
      { kind: 'goto', x: 2000, y: 1500, r: 60, text: 'Gate 5/8' },
      { kind: 'goto', x: 1600, y: 1500, r: 60, text: 'Gate 6/8' },
      { kind: 'goto', x: 1200, y: 1500, r: 60, text: 'Gate 7/8' },
      { kind: 'goto', x: 1200, y: 1200, r: 60, text: 'Gate 8/8 — finish' },
    ],
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

export function startMission(G, id) {
  const def = missionById(id);
  if (!def || G.mission) return false;
  const m = {
    def, stage: 0,
    timer: def.time,
    surviveT: 0,
    truck: null,
    boat: null,
    startedAt: G.time,
  };
  if (id === 'getaway') {
    addWanted(G, 3, 'The patrol is on you');
  }
  if (id === 'heist') {
    const truck = makeVehicle('truck', 2000, 300, Math.PI / 2, { mission: 'heist' });
    truck.target = { x: 2800, y: 300 };
    G.cars.push(truck);
    m.truck = truck;
  }
  if (id === 'boat') {
    const boat = makeVehicle('boat', 3300, 1850, 0, { mission: 'boat' });
    G.cars.push(boat);
    m.boat = boat;
  }
  G.mission = m;
  G.message = def.name + ' — ' + def.desc;
  G.messageT = 4;
  if (G.audio) G.audio.jingle('start');
  return true;
}

export function abortMission(G, reason) {
  if (!G.mission) return;
  const name = G.mission.def.name;
  if (G.mission.truck && !G.mission.truck.dead) {
    G.mission.truck.dead = true;
  }
  G.mission = null;
  G.message = name + ' failed — ' + (reason || 'try again');
  G.messageT = 3.5;
  if (G.audio) G.audio.jingle('fail');
}

export function completeMission(G) {
  const m = G.mission;
  if (!m) return;
  const def = m.def;
  G.player.cash += def.payout;
  G.missionsDone[def.id] = true;
  G.mission = null;
  G.message = def.name + ' complete! +' + fmtCash(def.payout);
  G.messageT = 4;
  G.completedFlash = 2;
  if (G.audio) G.audio.jingle('win');
  // Save progress.
  try {
    const raw = window.localStorage.getItem('sunset-keys-save-v5');
    const s = raw ? JSON.parse(raw) : {};
    s.cash = Math.floor(G.player.cash);
    s.done = G.missionsDone;
    window.localStorage.setItem('sunset-keys-save-v5', JSON.stringify(s));
  } catch (e) {
    // Storage can be off; the session still plays.
  }
}

export function currentObjective(G) {
  const m = G.mission;
  if (!m) return null;
  return m.def.stages[m.stage] || null;
}

// "Stage 2/5" for the HUD, or '' when no mission is running.
export function missionStageText(G) {
  const m = G.mission;
  if (!m) return '';
  const n = m.def.stages.length;
  const cur = Math.min(m.stage + 1, n);
  return 'Stage ' + cur + '/' + n;
}

export function updateMission(G, dt) {
  const m = G.mission;
  if (!m) return;
  // Timed missions.
  if (m.def.time > 0) {
    m.timer -= dt;
    if (m.timer <= 0) {
      abortMission(G, 'time ran out');
      return;
    }
  }
  const obj = currentObjective(G);
  if (!obj) {
    completeMission(G);
    return;
  }
  const p = G.player;
  if (obj.kind === 'goto') {
    const d = dist(p.x, p.y, obj.x, obj.y);
    if (d < obj.r) {
      m.stage += 1;
      if (G.audio) G.audio.jingle('checkpoint');
      if (m.stage >= m.def.stages.length) completeMission(G);
      else {
        G.message = m.def.stages[m.stage].text;
        G.messageT = 2.5;
      }
    }
  } else if (obj.kind === 'survive') {
    m.surviveT += dt;
    if (m.surviveT >= obj.seconds) {
      m.stage += 1;
      G.message = m.def.stages[m.stage].text;
      G.messageT = 2.5;
      if (G.audio) G.audio.jingle('checkpoint');
    }
  } else if (obj.kind === 'ram') {
    if (m.truck && m.truck.dead) {
      m.stage += 1;
      G.message = m.def.stages[m.stage].text;
      G.messageT = 2.5;
      if (G.audio) G.audio.jingle('checkpoint');
    }
  } else if (obj.kind === 'collect') {
    if (m.truck && dist(p.x, p.y, m.truck.x, m.truck.y) < obj.r) {
      completeMission(G);
    }
  }
}

// The mission start marker the player is standing on, if any.
export function missionAt(G) {
  if (G.mission) return null;
  for (const def of MISSIONS) {
    if (G.missionsDone[def.id]) continue;
    if (dist(G.player.x, G.player.y, def.start.x, def.start.y) < 90) return def;
  }
  return null;
}

export function drawMissionMarkers(ctx, G, view) {
  // Start markers for missions not yet done.
  for (const def of MISSIONS) {
    if (G.mission || G.missionsDone[def.id]) continue;
    if (def.start.x < view.x0 - 120 || def.start.x > view.x1 + 120 || def.start.y < view.y0 - 120 || def.start.y > view.y1 + 120) continue;
    const pulse = 1 + 0.15 * Math.sin(G.time * 4);
    ctx.save();
    ctx.translate(def.start.x, def.start.y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = '#ffe600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, 7);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, def.start.x, def.start.y - 44);
    ctx.restore();
  }
  // Current objective.
  const obj = currentObjective(G);
  if (obj && obj.x !== undefined) {
    const pulse = 1 + 0.2 * Math.sin(G.time * 6);
    ctx.save();
    ctx.translate(obj.x, obj.y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = '#00ffa3';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, obj.r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,255,163,0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, obj.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // A beam of light so the objective is visible from afar.
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.15 * Math.sin(G.time * 6);
    ctx.fillStyle = '#00ffa3';
    ctx.fillRect(obj.x - 5, obj.y - 320, 10, 320);
    ctx.restore();
  }
  // The truck, when it is the heist target.
  const m = G.mission;
  if (m && m.truck && !m.truck.dead) {
    ctx.save();
    ctx.strokeStyle = '#ff2e63';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.truck.x, m.truck.y, 52 + 4 * Math.sin(G.time * 5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
