// Neon Bay Heat — boot, game loop, chase camera, input, screens, save.
// All original code. Three.js is vendored under game/vendor.
import * as THREE from '../vendor/three.module.min.js';
import { buildCity } from './city.js';
import { createWorld, WEAPONS } from './world.js';
import { createMissions, MISSION_DEFS } from './missions.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';
import { clamp, damp, fmtCash, fmtClock } from './util.js';
import { stageShot } from './shots.js';
import { showBriefing, completionLine } from './story.js';
import { createTaxi } from './taxi.js';
import { createShop } from './shop.js';

const STEP = 1 / 60;
const SAVE_KEY = 'neonbay-save-v1';
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261121;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');

function makeRenderer() {
  let r;
  try {
    r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    statusEl.textContent = 'WebGL is not available in this browser.';
    throw e;
  }
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  r.setSize(window.innerWidth, window.innerHeight);
  return r;
}

const renderer = makeRenderer();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a1e33);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const audio = createAudio();
const built = buildCity(scene, seed);
const city = built.city;

let screen = 'title'; // title | play | paused | end
let endKind = 'wasted';
let tod = 0.72; // late afternoon, golden hour
let objectiveText = 'Welcome to Neon Bay — steal a car, make some cash.';
let camYaw = 0;
let camPitch = 0.32;
let camDist = 8;
let camDistOverride = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let attractT = 0;
let taxi = null;
let shop = null;

const hooks = {
  onBanner: (t, s) => hud.banner(t, s),
  onToast: (t) => hud.toast(t),
  onObjective: (t) => { objectiveText = t; hud.setObjective(t); },
  onMissionTick: () => {},
  onMissionComplete: (id, reward) => {
    saveGame();
    hud.toast('Mission complete  +' + fmtCash(reward));
    const line = completionLine(id);
    if (line) hud.toast(line);
    hud.setJobsDone(missions.done.length, MISSION_DEFS.length);
  },
  onMissionFailed: () => {},
  onMissionStart: (id) => {
    if (shotName) return;
    const def = MISSION_DEFS.find((d) => d.id === id);
    if (def) showBriefing(def);
  },
  onSteal: (name) => hud.toast('Stole a ' + name + ' — the law is coming'),
  onPedDown: () => {},
  onPickup: (kind) => hud.toast(kind === 'cash' ? 'Cash found' : '+50 ' + kind.toUpperCase()),
  onNoAmmo: () => hud.toast('OUT OF AMMO — find an ammo pickup'),
  onWanted: () => {},
  onHurt: () => hud.damageFlash(),
  onEnterVehicle: (name) => {
    hud.toast(name);
    if (name === 'City Cab' && taxi) taxi.onEnterTaxi();
  },
  onExitVehicle: () => {},
  onStunt: () => saveGame(),
  onWasted: () => {
    endKind = 'wasted';
    screen = 'end';
    hud.showEnd('wasted', 'The city keeps moving without you. 10% of your cash is gone.');
    world.cash = Math.floor(world.cash * 0.9);
    saveGame();
  },
  onBusted: () => {
    endKind = 'busted';
    screen = 'end';
    hud.showEnd('busted', 'The NBPD has you. 10% of your cash is gone.');
    world.cash = Math.floor(world.cash * 0.9);
    saveGame();
  },
  onRespawn: () => {},
  onTruckDestroyed: () => {},
};

const world = createWorld(scene, city, audio, hooks);
const missions = createMissions(scene, world, city, audio, hooks);
const hud = createHUD(hooks);
taxi = createTaxi(scene, world, city, audio, hooks);
shop = createShop(scene, world, city, audio, hooks);

// Headlight for the player's car at night.
const headlight = new THREE.SpotLight(0xffe9b0, 0, 70, 0.55, 0.55, 1.1);
const headTarget = new THREE.Object3D();
scene.add(headlight);
scene.add(headTarget);
headlight.target = headTarget;

// ---------- save / load ----------
function saveGame() {
  if (shotName) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: world.cash,
      done: missions.done,
      station: audio.stationIndex,
    }));
  } catch { /* storage can be off; the session still plays */ }
}

function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.cash === 'number') world.cash = s.cash;
    if (Array.isArray(s.done)) missions.loadDone(s.done);
    if (typeof s.station === 'number') audio.setStation(s.station);
    return s;
  } catch {
    return null;
  }
}
const save = shotName ? null : loadGame();

// ---------- input ----------
const keys = {};
const input = {
  f: false, b: false, l: false, r: false,
  sprint: false, jump: false, handbrake: false, nitro: false,
  shoot: false, enter: false, weapon: 0,
  aimDir: new THREE.Vector3(0, 0, 1),
  aimOrigin: new THREE.Vector3(),
};

function refreshInput() {
  input.f = !!(keys.KeyW || keys.ArrowUp);
  input.b = !!(keys.KeyS || keys.ArrowDown);
  input.l = !!(keys.KeyA || keys.ArrowLeft);
  input.r = !!(keys.KeyD || keys.ArrowRight);
  input.sprint = !!(keys.ShiftLeft || keys.ShiftRight);
  input.nitro = input.sprint;
  input.handbrake = !!keys.Space && !!world.player.vehicle;
  input.jump = !!keys.Space && !world.player.vehicle;
}

function startPlay() {
  audio.unlock();
  hud.hideTitle();
  screen = 'play';
  statusEl.textContent = 'Playing Neon Bay Heat.';
}

function continueAfterEnd() {
  hud.hideEnd();
  world.respawn(endKind);
  screen = 'play';
}

function bindInput() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    refreshInput();
    if (e.code === 'KeyE' || e.code === 'KeyF') input.enter = true;
    if (e.code === 'KeyR') {
      const name = audio.nextStation();
      hud.toast('Radio: ' + name);
    }
    if (e.code === 'KeyM') {
      audio.setMuted(!audio.isMuted);
      hud.toast(audio.isMuted ? 'Sound muted' : 'Sound on');
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (screen === 'play') {
        screen = 'paused';
        hud.showPause(true);
      } else if (screen === 'paused') {
        screen = 'play';
        hud.showPause(false);
      }
    }
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit) input.weapon = Number(digit[1]);
    if (e.code === 'Enter' && screen === 'title') startPlay();
    if (e.code === 'Enter' && screen === 'end') continueAfterEnd();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    refreshInput();
  });
  canvas.addEventListener('mousedown', (e) => {
    if (screen !== 'play') return;
    if (e.button === 0) input.shoot = true;
    if (e.button === 2) input.aim = true;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!document.pointerLockElement) canvas.requestPointerLock?.();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.shoot = false;
    if (e.button === 2) input.aim = false;
    dragging = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
  });
  window.addEventListener('mousemove', (e) => {
    if (screen !== 'play') return;
    if (document.pointerLockElement === canvas) {
      camYaw -= e.movementX * 0.0032;
      camPitch = clamp(camPitch + e.movementY * 0.0022, 0.08, 1.1);
    } else if (dragging) {
      camYaw -= (e.clientX - lastX) * 0.005;
      camPitch = clamp(camPitch + (e.clientY - lastY) * 0.003, 0.08, 1.1);
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  window.addEventListener('wheel', (e) => {
    if (screen !== 'play') return;
    const p = world.player;
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = (p.weapon + dir + 4) % 4;
    input.weapon = next + 1;
  }, { passive: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (screen === 'play') {
        screen = 'paused';
        hud.showPause(true);
      }
      saveGame();
    }
  });
}
bindInput();
hud.onPlayClick(startPlay);
hud.onContinueClick(continueAfterEnd);

// Small debug hook for automated play-testing (driving state, position, wanted).
window.__dbg = () => ({
  screen,
  driving: !!world.player.vehicle,
  vehicle: world.player.vehicle?.def.name ?? null,
  pos: [Math.round(world.playerPos().x), Math.round(world.playerPos().z)],
  wanted: world.wanted,
  cash: world.cash,
  health: Math.round(world.player.health),
  weapon: world.player.weapon,
  ammo: world.player.ammo[world.player.weapon],
  mission: missions.active?.def.id ?? null,
});

// ---------- camera ----------
const camTarget = new THREE.Vector3();
const camProbe = { x: 0, z: 0 };

function easeYawToward(target, rate, dt) {
  let d = target - camYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  camYaw += d * (1 - Math.exp(-rate * dt));
}

function updateCamera(dt) {
  const p = world.player;
  const driving = !!p.vehicle;
  const focus = driving ? p.vehicle.pos : p.pos;
  const speed = driving ? Math.abs(p.vehicle.speed) : Math.hypot(p.vel.x, p.vel.z);
  if (driving) easeYawToward(p.vehicle.heading, 1.6, dt);
  else if (speed > 1.5) easeYawToward(Math.atan2(p.vel.x, p.vel.z), 2.2, dt);
  const wantDist = camDistOverride > 0 ? camDistOverride : (driving ? 10.5 + speed * 0.05 : 7.5);
  camDist = damp(camDist, wantDist, 4, dt);
  camTarget.set(focus.x, (focus.y || 0) + (driving ? 2.6 : 2.1), focus.z);
  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  let dist = camDist;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    cx = camTarget.x - Math.sin(camYaw) * cp * dist;
    cy = camTarget.y + sp * dist;
    cz = camTarget.z - Math.cos(camYaw) * cp * dist;
    camProbe.x = cx;
    camProbe.z = cz;
    const hit = city.collideCircle(camProbe, 0.6);
    if (!hit) break;
    cx = camProbe.x;
    cz = camProbe.z;
    if (attempt === 3) break;
    dist *= 0.62;
  }
  camera.position.set(cx, Math.max(cy, 1.1), cz);
  camera.lookAt(camTarget.x, camTarget.y + 0.4, camTarget.z);
  const targetFov = driving ? 62 + clamp(speed / 60, 0, 1) * 12 + (p.vehicle.nitro ? 5 : 0) : 62;
  camera.fov = damp(camera.fov, targetFov, 5, dt);
  camera.updateProjectionMatrix();
  camera.getWorldDirection(input.aimDir);
  input.aimOrigin.copy(camera.position);
  if (driving && p.vehicle.def.kind !== 'boat') {
    const v = p.vehicle;
    const nightF = 1 - clamp(Math.sin((tod - 0.25) * Math.PI * 2) * 2.2, 0, 1);
    headlight.intensity = nightF * 220;
    headlight.position.set(
      v.pos.x + Math.sin(v.heading) * 2.2, 1.2, v.pos.z + Math.cos(v.heading) * 2.2,
    );
    headTarget.position.set(
      v.pos.x + Math.sin(v.heading) * 40, 0.5, v.pos.z + Math.cos(v.heading) * 40,
    );
  } else {
    headlight.intensity = 0;
  }
}

// ---------- HUD state ----------
function hudState() {
  const p = world.player;
  const v = p.vehicle;
  const clock = fmtClock(tod);
  return {
    health: p.health,
    armor: p.armor,
    cash: world.cash,
    wanted: Math.round(world.wanted),
    weaponName: WEAPONS[p.weapon].name,
    weaponIndex: p.weapon,
    ammo: p.ammo[p.weapon],
    driving: !!v,
    onFoot: !v,
    speedKmh: v ? Math.abs(v.speed) * 2.237 : 0,
    vehicleName: v ? v.def.name : '',
    nitro: v && v.def.nitro ? v.nitroFuel : 0,
    radio: audio.stationName,
    clock,
    missionTime: missions.active ? missions.active.timeLeft : null,
    objective: missions.active ? objectiveText : (taxi?.fareText() ?? objectiveText),
    minimap: {
      player: { x: world.playerPos().x, z: world.playerPos().z, heading: v ? v.heading : p.heading },
      markers: [...missions.getMarkers(), ...taxi.getMarkers(), ...shop.getMarkers()],
      police: world.police.filter((c) => !c.dead).map((c) => ({ x: c.pos.x, z: c.pos.z })),
      traffic: world.traffic.filter((t) => !t.dead).map((t) => ({ x: t.pos.x, z: t.pos.z })),
      peds: world.peds.filter((pd) => !pd.dead).map((pd) => ({ x: pd.pos.x, z: pd.pos.z })),
      truck: world.truck && !world.truck.dead ? { x: world.truck.pos.x, z: world.truck.pos.z } : null,
      heli: world.heli ? { x: world.heli.group.position.x, z: world.heli.group.position.z } : null,
    },
  };
}

// ---------- main loop ----------
let last = performance.now();
let accumulator = 0;
let saveTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (screen === 'paused') {
    renderer.render(scene, camera);
    return;
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    world.update(STEP, input, camYaw);
    missions.update(STEP);
    taxi.update(STEP);
    shop.update(STEP);
    input.enter = false;
    input.weapon = 0;
    accumulator -= STEP;
    steps += 1;
  }
  if (steps === 5) accumulator = 0;
  tod = (tod + dt / 360) % 1;
  const focus = world.playerPos();
  city.update(dt, tod, focus);
  if (screen === 'title') {
    // Slow orbit over the beachfront: the pier, the boardwalk and the hotels
    // drift past behind the title, so the first thing a player sees is the
    // city's postcard view.
    attractT += dt;
    const ax = 185 + Math.sin(attractT * 0.06) * 45;
    const az = Math.cos(attractT * 0.06) * 60;
    camera.position.set(ax, 18 + Math.sin(attractT * 0.11) * 4, az);
    camera.lookAt(178, 5, 0);
  } else {
    updateCamera(dt);
  }
  const pv = world.player.vehicle;
  if (pv && pv.airT > 0) {
    pv.airT -= dt;
    const k = 1 - pv.airT / 0.9;
    pv.mesh.position.y = Math.sin(k * Math.PI) * 2.4;
    pv.mesh.rotation.x = Math.sin(k * Math.PI) * -0.25;
  }
  audio.update();
  hud.update(hudState());
  saveTimer += dt;
  if (saveTimer > 20) {
    saveTimer = 0;
    saveGame();
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
if (shotName) {
  // Deterministic staged screenshot: no loop, no title screen.
  hud.hideTitle();
  screen = 'play';
  const G = {
    scene, camera, renderer, world, missions, city, hud, audio,
    input,
    get tod() { return tod; },
    setTod(v) { tod = v; },
    get camYaw() { return camYaw; },
    setCamYaw(v) { camYaw = v; },
    setCamDist(v) { camDistOverride = v; },
    step(dt, inp) {
      world.update(dt, inp ?? input, camYaw);
      missions.update(dt);
    },
    updateCamera,
    render() {
      const focus = world.playerPos();
      city.update(0.016, tod, focus);
      renderer.render(scene, camera);
    },
  };
  stageShot(shotName, G);
  let painted = 0;
  function paint() {
    G.render();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
} else {
  const hasSave = !!save;
  hud.showTitle(hasSave, hasSave
    ? 'Save found: ' + fmtCash(save.cash) + ' · ' + (save.done?.length ?? 0) + ' jobs done — progress restored.'
    : '');
  hud.setJobsDone(missions.done.length, MISSION_DEFS.length);
  statusEl.textContent = 'Neon Bay Heat. Press PLAY.';
  window.__gameReady = true;
  requestAnimationFrame(frame);
}
