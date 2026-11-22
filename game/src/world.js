// Sunset Keys — the world: game state, the player on foot and behind the wheel,
// collisions, bullets, the camera and the day/night cycle. Written fresh for round 5.
import { clamp, dist, wrapAngle, angleTo, mulberry32, rand, fmtCash } from './util.js';
import { buildCity, drawCity, skyFor, collideBuildings, isWater, isBeach, SEA_X, WORLD_W, WORLD_H } from './city.js';
import { VEHICLE_DEFS, makeVehicle, driveVehicle, bumpVehicles, damageVehicle, spawnTraffic, updateTraffic, drawVehicle, forwardSpeed } from './vehicles.js';
import { addWanted, updatePolice, drawHeli, saveGame, loadGame, wastePlayer } from './police.js';
import { spawnPeds, updatePeds, drawPeds } from './peds.js';
import { MISSIONS, startMission, updateMission, missionAt, drawMissionMarkers } from './missions.js';
import { AudioSys } from './audio.js';
import { buildHud, updateHud, missionListHtml } from './hud.js';
import { nearestShop, shopItems, buyFromShop } from './shop.js';
import { makeParticles, updateParticles, drawParticles, spawnSmoke, spawnSparks, spawnSpray, spawnBurst, addSkid, addShake } from './effects.js';

export function createGame(canvas) {
  const city = buildCity();
  const G = {
    canvas, ctx: canvas.getContext('2d'),
    time: 0, clock: 17.5, // 5:30 PM — golden hour over the Keys.
    city, missionDefs: MISSIONS,
    player: {
      x: 1200, y: 1200, angle: 0, vx: 0, vy: 0, speed: 0,
      onFoot: true, health: 100, armor: 0, cash: 500, car: null,
    },
    cars: [], peds: [], bullets: [],
    wanted: 0, wantedFlash: 0, lastSeen: -100, decayT: 0, policeTimer: 0, bustT: 0,
    roadblockDone: false,
    heli: { active: false, x: 0, y: 0, angle: 0 },
    mission: null, missionsDone: {},
    owned: {}, paint: '#ff2e63', radioStation: 0, weapon: false,
    camera: { x: 1200, y: 1200, zoom: 0.62 },
    particles: makeParticles(),
    trafficRng: mulberry32(99),
    state: 'title', stateT: 0,
    message: '', messageT: 0, prompt: '',
    shopOpen: null, shop: null,
    completedFlash: 0,
    saveT: 0,
    skyNight: 0,
    audio: new AudioSys(),
    hud: null,
    verifyMode: false,
    shotMode: null,
  };
  G.hud = buildHud();
  loadGame(G);
  // A starter car parked by the plaza, and the island's traffic and walkers.
  const starter = makeVehicle('spyder', 1260, 1200, 0, { color: G.paint });
  G.cars.push(starter);
  const boat = makeVehicle('boat', 3300, 1850, 0, {});
  G.cars.push(boat);
  spawnTraffic(G, 14);
  spawnPeds(G, 22);
  G.hud.titleMissions.innerHTML = missionListHtml(G, MISSIONS);
  G.hud.pauseMissions.innerHTML = missionListHtml(G, MISSIONS);
  return G;
}

function nearestCar(G, maxD) {
  let best = null;
  let bd = maxD;
  for (const car of G.cars) {
    if (car.dead || car.traffic) continue;
    const d = dist(G.player.x, G.player.y, car.x, car.y);
    if (d < bd) {
      bd = d;
      best = car;
    }
  }
  return best;
}

function enterCar(G, car) {
  G.player.car = car;
  G.player.onFoot = false;
  G.player.x = car.x;
  G.player.y = car.y;
  G.player.angle = car.angle;
  if (car.defId === 'boat') {
    G.message = 'You are sailing the ' + car.def.name;
  } else {
    G.message = 'You are driving the ' + car.def.name;
  }
  G.messageT = 2;
  if (G.audio) G.audio.blip(660, 0.12, 'triangle', 0.15);
}

function exitCar(G) {
  const car = G.player.car;
  if (!car) return;
  const side = car.angle + Math.PI / 2;
  G.player.x = car.x + Math.cos(side) * 34;
  G.player.y = car.y + Math.sin(side) * 34;
  G.player.vx = 0;
  G.player.vy = 0;
  G.player.angle = car.angle;
  G.player.onFoot = true;
  G.player.car = null;
}

function shootAt(G, mx, my) {
  if (!G.weapon || G.player.onFoot === false) return;
  const rect = G.canvas.getBoundingClientRect();
  const sx = mx - rect.left;
  const sy = my - rect.top;
  // Screen -> world.
  const cam = G.camera;
  const wx = cam.x + (sx - G.canvas.width / 2) / cam.zoom;
  const wy = cam.y + (sy - G.canvas.height / 2) / cam.zoom;
  const a = angleTo(G.player.x, G.player.y, wx, wy);
  G.bullets.push({
    x: G.player.x, y: G.player.y,
    vx: Math.cos(a) * 900, vy: Math.sin(a) * 900,
    life: 0.9,
  });
  if (G.audio) G.audio.gunshot();
  addWanted(G, 0, '');
}

function updateBullets(G, dt) {
  for (const b of G.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    // Hit a car?
    for (const car of G.cars) {
      if (car.dead) continue;
      if (dist(b.x, b.y, car.x, car.y) < car.def.len * 0.4) {
        b.life = 0;
        const died = damageVehicle(car, 34);
        spawnSparks(G.particles, b.x, b.y, 6);
        if (car.police) addWanted(G, 1, 'You shot at the patrol');
        if (died && car === G.player.car) exitCar(G);
        break;
      }
    }
    // Hit a pedestrian?
    for (const p of G.peds) {
      if (p.state === 'down') continue;
      if (dist(b.x, b.y, p.x, p.y) < 14) {
        b.life = 0;
        p.state = 'down';
        p.downT = 5;
        addWanted(G, 1, 'You shot a pedestrian');
        break;
      }
    }
    // Hit a building.
    if (b.life > 0) {
      for (const bd of G.city.buildings) {
        if (b.x > bd.x && b.x < bd.x + bd.w && b.y > bd.y && b.y < bd.y + bd.h) {
          b.life = 0;
          spawnSparks(G.particles, b.x, b.y, 4);
          break;
        }
      }
    }
  }
  G.bullets = G.bullets.filter((b) => b.life > 0);
}

function updatePlayer(G, input, dt) {
  const p = G.player;
  if (p.car) {
    const car = p.car;
    const onWater = car.defId === 'boat';
    const nitro = input.nitro && !onWater;
    const throttle = (input.up ? 1 : 0) - (input.down ? 0.8 : 0);
    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    driveVehicle(car, { throttle: nitro ? throttle * 1.45 : throttle, steer, handbrake: input.handbrake }, dt, onWater);
    // Cars cannot enter the sea; boats cannot leave it.
    if (!onWater) {
      if (car.x > SEA_X - 12) {
        car.x = SEA_X - 12;
        car.vx *= -0.3;
        car.vy *= 0.7;
      }
      car.x = clamp(car.x, 40, SEA_X - 12);
      car.y = clamp(car.y, 40, WORLD_H - 40);
    } else {
      if (car.x < SEA_X + 12) {
        car.x = SEA_X + 12;
        car.vx *= -0.3;
      }
      car.x = clamp(car.x, SEA_X + 12, WORLD_W - 40);
      car.y = clamp(car.y, 40, WORLD_H - 40);
      // Wake.
      car.wake += dt;
      if (car.wake > 0.08 && car.speed > 60) {
        car.wake = 0;
        spawnSpray(G.particles, car.x - Math.cos(car.angle) * 26, car.y - Math.sin(car.angle) * 26, 2);
      }
    }
    // Buildings stop cars.
    const pos = { x: car.x, y: car.y };
    if (collideBuildings(G.city, pos, car.def.len * 0.32)) {
      const hitSpeed = car.speed;
      car.x = pos.x;
      car.y = pos.y;
      // Kill the velocity component into the wall.
      car.vx *= 0.4;
      car.vy *= 0.4;
      if (hitSpeed > 140) {
        damageVehicle(car, (hitSpeed - 140) * 0.12);
        spawnSparks(G.particles, car.x, car.y, 8);
        addShake(G.particles, 5);
        if (G.audio) G.audio.crash(hitSpeed / 500);
        if (car === p.car) {
          hurtPlayer(G, (hitSpeed - 140) * 0.06);
        }
      }
    }
    // A wrecked car smoulders where it died.
    if (car.dead) {
      car.smokeT = (car.smokeT || 0) + dt;
      if (car.smokeT > 0.25) {
        car.smokeT = 0;
        spawnSmoke(G.particles, car.x, car.y - 6, 1, 'rgba(60,60,60,0.6)');
      }
    }
    // Drift smoke + skid marks.
    const lat = Math.abs(car.vx * -Math.sin(car.angle) + car.vy * Math.cos(car.angle));
    if ((input.handbrake && car.speed > 140) || lat > 150) {
      const bx = car.x - Math.cos(car.angle) * 18;
      const by = car.y - Math.sin(car.angle) * 18;
      spawnSmoke(G.particles, bx, by, 1);
      addSkid(G.particles, bx, by, bx + car.vx * 0.02, by + car.vy * 0.02);
    }
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    p.vx = car.vx;
    p.vy = car.vy;
    p.speed = car.speed;
    if (car.dead) {
      exitCar(G);
      G.message = 'Your ride is wrecked';
      G.messageT = 2.5;
    }
    if (G.audio) G.audio.setEngine(clamp(Math.abs(car.speed) / car.def.topSpeed, 0, 1), true);
  } else {
    // On foot.
    const run = input.sprint ? 250 : 140;
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 0) {
      mx /= len;
      my /= len;
      p.angle = Math.atan2(my, mx);
    }
    p.vx = mx * run;
    p.vy = my * run;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // Water blocks walking, except on the pier.
    const onPier = p.x > 3180 && p.x < 3500 && Math.abs(p.y - 1200) < 32;
    if (isWater(p.x, p.y) && !onPier) {
      p.x -= p.vx * dt;
      p.y -= p.vy * dt;
      p.vx = 0;
      p.vy = 0;
    }
    p.x = clamp(p.x, 40, 3520);
    p.y = clamp(p.y, 40, WORLD_H - 40);
    const pos = { x: p.x, y: p.y };
    if (collideBuildings(G.city, pos, 12)) {
      p.x = pos.x;
      p.y = pos.y;
    }
    p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (G.audio) G.audio.setEngine(0, false);
  }
}

export function hurtPlayer(G, amount) {
  const p = G.player;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, amount);
    p.armor -= absorbed;
    amount -= absorbed;
  }
  p.health -= amount;
  if (p.health <= 0) {
    p.health = 0;
    wastePlayer(G);
  }
}

function updateCarCollisions(G, dt) {
  const cars = G.cars;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.dead) continue;
      // Boats never collide with road cars.
      if ((a.defId === 'boat') !== (b.defId === 'boat')) continue;
      const impact = bumpVehicles(a, b);
      if (impact > 90) {
        spawnSparks(G.particles, (a.x + b.x) / 2, (a.y + b.y) / 2, 6);
        addShake(G.particles, 3);
        if (G.audio) G.audio.crash(impact / 500);
        const playerCar = G.player.car;
        // Ramming the vault truck damages it; other hits damage both.
        if (a.mission === 'heist' || b.mission === 'heist') {
          const truck = a.mission === 'heist' ? a : b;
          const other = truck === a ? b : a;
          if (other === playerCar && impact > 90) {
            damageVehicle(truck, impact * 0.55);
            damageVehicle(other, impact * 0.08);
          }
        } else {
          damageVehicle(a, impact * 0.05);
          damageVehicle(b, impact * 0.05);
        }
        if (a.police || b.police) {
          const cop = a.police ? a : b;
          const other = cop === a ? b : a;
          if (other === playerCar && impact > 120) addWanted(G, 1, 'You hit a patrol car');
        }
        if (a === playerCar || b === playerCar) {
          hurtPlayer(G, impact * 0.03);
        }
      }
    }
  }
  // Remove wrecks that are not the player's or a mission vehicle.
  G.cars = G.cars.filter((c) => !c.dead || c === G.player.car || c.mission);
  // Keep traffic topped up.
  const traffic = G.cars.filter((c) => c.traffic).length;
  if (traffic < 12) spawnTraffic(G, 12 - traffic);
}

export function updateGame(G, input, dt) {
  G.time += dt;
  G.clock += dt * (24 / 600); // A full day in ten minutes.
  if (G.clock >= 24) G.clock -= 24;
  const sky = skyFor(G.clock);
  G.skyNight = sky.night;

  if (G.state === 'title') {
    // The title screen orbits the city slowly.
    G.camera.x = 1800 + Math.cos(G.time * 0.05) * 500;
    G.camera.y = 1200 + Math.sin(G.time * 0.04) * 300;
    G.camera.zoom = 0.45;
    updateTraffic(G, dt);
    updatePeds(G, dt);
    updateParticles(G.particles, dt);
    return;
  }
  if (G.state === 'paused') return;
  if (G.state === 'busted' || G.state === 'wasted') {
    G.stateT += dt;
    if (G.stateT > 2.2) {
      G.state = 'playing';
      G.stateT = 0;
    }
    return;
  }

  // Enter / exit car.
  if (input.enter) {
    input.enter = false;
    if (G.player.car) {
      exitCar(G);
    } else {
      const car = nearestCar(G, 70);
      if (car) enterCar(G, car);
    }
  }
  // Mission start.
  if (input.enterMission) {
    input.enterMission = false;
    const def = missionAt(G);
    if (def) startMission(G, def.id);
  }
  // Shooting.
  if (input.shoot) {
    input.shoot = false;
    shootAt(G, input.mouseX, input.mouseY);
  }

  updatePlayer(G, input, dt);
  updateTraffic(G, dt);
  updatePeds(G, dt);
  updatePolice(G, dt);
  updateMission(G, dt);
  updateBullets(G, dt);
  updateCarCollisions(G, dt);
  updateParticles(G.particles, dt);

  // The vault truck drives its highway loop.
  for (const car of G.cars) {
    if (car.mission === 'heist' && !car.dead) {
      const d = dist(car.x, car.y, car.target.x, car.target.y);
      if (d < 80) {
        car.target = car.target.x === 2800 ? { x: 2800, y: 2100 } : car.target.y === 2100 ? { x: 400, y: 2100 } : car.target.x === 400 ? { x: 400, y: 300 } : { x: 2800, y: 300 };
      }
      const want = angleTo(car.x, car.y, car.target.x, car.target.y);
      const steer = clamp(wrapAngle(want - car.angle) * 1.5, -1, 1);
      driveVehicle(car, { throttle: 0.6, steer, handbrake: false }, dt, false);
    }
  }

  // Camera follows the player, zooming out with speed.
  const speedN = G.player.car ? clamp(Math.abs(G.player.car.speed) / 540, 0, 1) : 0;
  const targetZoom = 0.62 - speedN * 0.14;
  G.camera.zoom += (targetZoom - G.camera.zoom) * dt * 2;
  G.camera.x += (G.player.x - G.camera.x) * Math.min(1, dt * 4);
  G.camera.y += (G.player.y - G.camera.y) * Math.min(1, dt * 4);

  // Prompts: shops, missions, cars.
  G.prompt = '';
  if (!G.mission) {
    const def = missionAt(G);
    if (def) G.prompt = 'Press E — start job: ' + def.name + ' (' + fmtCash(def.payout) + ')';
  }
  if (!G.prompt) {
    const shop = nearestShop(G);
    if (shop) G.prompt = 'Press E — ' + shop.name;
    else if (!G.player.car && nearestCar(G, 70)) G.prompt = 'Press E — get in the car';
    else if (G.player.car) G.prompt = 'E — get out · R — radio · M — mute';
  }
  if (G.shopOpen) G.prompt = '';

  // Siren when the patrol is close.
  const nearCop = G.cars.some((c) => c.police && !c.dead && dist(c.x, c.y, G.player.x, G.player.y) < 700);
  if (G.audio) G.audio.setSiren(nearCop && G.wanted > 0, G.wanted);

  // Autosave.
  G.saveT += dt;
  if (G.saveT > 12) {
    G.saveT = 0;
    saveGame(G);
  }
  if (G.wantedFlash > 0) G.wantedFlash -= dt;
}

export function drawGame(G) {
  const ctx = G.ctx;
  const canvas = G.canvas;
  const cam = G.camera;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Sky gradient behind everything.
  const sky = skyFor(G.clock);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(0.6, sky.mid);
  grad.addColorStop(1, sky.ground);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2 + G.particles.shakeX, h / 2 + G.particles.shakeY);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const view = {
    x0: cam.x - w / 2 / cam.zoom - 60,
    y0: cam.y - h / 2 / cam.zoom - 60,
    x1: cam.x + w / 2 / cam.zoom + 60,
    y1: cam.y + h / 2 / cam.zoom + 60,
  };
  drawCity(ctx, G.city, G, view);
  drawParticles(ctx, G.particles);
  drawMissionMarkers(ctx, G, view);
  drawPeds(ctx, G, view);
  // Cars, sorted so the player's car draws last (on top).
  const cars = G.cars.slice().sort((a, b) => (a === G.player.car ? 1 : 0) - (b === G.player.car ? 1 : 0));
  for (const car of cars) {
    if (car.x < view.x0 - 120 || car.x > view.x1 + 120 || car.y < view.y0 - 120 || car.y > view.y1 + 120) continue;
    drawVehicle(ctx, car, G);
  }
  drawHeli(ctx, G);
  // Bullets.
  ctx.fillStyle = '#ffe600';
  for (const b of G.bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // The player on foot.
  if (G.player.onFoot) {
    const p = G.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const bob = Math.sin(G.time * 10) * 1.5;
    ctx.fillStyle = '#ff2e63';
    ctx.beginPath();
    ctx.arc(0, bob * 0.3, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(0, -3 + bob * 0.3, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1c22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(p.angle) * 12, Math.sin(p.angle) * 12);
    ctx.stroke();
    // Player ring.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14 + 2 * Math.sin(G.time * 4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Night darkening + sunset tint over the whole frame.
  if (sky.night > 0.05) {
    ctx.fillStyle = 'rgba(8,8,28,' + (sky.night * 0.34).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
  }
  if (sky.sun > 0.3) {
    ctx.fillStyle = 'rgba(255,120,40,' + ((sky.sun - 0.3) * 0.22).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
  }
  // Vignette.
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}
