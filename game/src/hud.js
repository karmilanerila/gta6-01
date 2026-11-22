// Sunset Keys — the HUD: DOM panels, the minimap, menus and messages.
// Written fresh for round 5.
import { fmtCash, fmtTime, fmtClock, clamp } from './util.js';
import { WORLD_W, WORLD_H, SEA_X, BEACH_X, STREETS_X, STREETS_Y } from './city.js';
import { currentObjective, missionStageText } from './missions.js';

export function buildHud() {
  const root = document.getElementById('hud');
  root.innerHTML = [
    '<div id="mission-box"><div id="mission-name"></div><div id="mission-obj"></div><div id="mission-timer"></div></div>',
    '<div id="top-right"><canvas id="minimap" width="210" height="150"></canvas>',
    '<div id="cash-line"><span id="cash">$500</span><span id="clock">5:30 PM</span></div>',
    '<div id="stars"></div></div>',
    '<div id="speed-box"><div id="speed">0</div><div id="speed-unit">mph · <span id="car-name">On foot</span></div></div>',
    '<div id="vitals"><div class="bar"><div id="health-fill"></div><span>HEALTH</span></div>',
    '<div class="bar"><div id="armor-fill"></div><span>ARMOR</span></div>',
    '<div id="radio-line">♪ <span id="radio-name">Sunset FM</span> <span id="radio-hint">[R] switch</span></div></div>',
    '<div id="message"></div>',
    '<div id="prompt"></div>',
    '<div id="banner"></div>',
    '<div id="title-screen"><div class="title-inner">',
    '<div class="title-kicker">CORAL BAY · THE KEYS</div>',
    '<h1>SUNSET<br>KEYS</h1>',
    '<p class="title-story">You are Kai, a driver new to the Keys, working off a debt to Marina — ' +
    'the fixer who runs the marina. Race, deliver, steal, survive. The patrol is always watching.</p>',
    '<div class="title-controls">WASD drive / walk · SHIFT sprint &amp; nitro · E enter / exit car · SPACE handbrake · ' +
    'R radio · M mute · CLICK shoot (with a pistol) · ESC pause</div>',
    '<div class="title-missions" id="title-missions"></div>',
    '<div class="title-start">PRESS ENTER TO PLAY</div>',
    '</div></div>',
    '<div id="pause-screen"><div class="pause-inner"><h2>PAUSED</h2>',
    '<p>Cash, missions and cars are saved automatically.</p>',
    '<div id="pause-missions"></div>',
    '<div class="title-start">ESC to resume</div></div></div>',
    '<div id="shop-panel"><h2 id="shop-title"></h2><div id="shop-items"></div>',
    '<div class="shop-close">E / ESC to close</div></div>',
    '<div id="verify"></div>',
  ].join('');
  return {
    missionName: document.getElementById('mission-name'),
    missionObj: document.getElementById('mission-obj'),
    missionTimer: document.getElementById('mission-timer'),
    minimap: document.getElementById('minimap'),
    cash: document.getElementById('cash'),
    clock: document.getElementById('clock'),
    stars: document.getElementById('stars'),
    speed: document.getElementById('speed'),
    carName: document.getElementById('car-name'),
    healthFill: document.getElementById('health-fill'),
    armorFill: document.getElementById('armor-fill'),
    radioName: document.getElementById('radio-name'),
    message: document.getElementById('message'),
    prompt: document.getElementById('prompt'),
    banner: document.getElementById('banner'),
    titleScreen: document.getElementById('title-screen'),
    pauseScreen: document.getElementById('pause-screen'),
    shopPanel: document.getElementById('shop-panel'),
    shopTitle: document.getElementById('shop-title'),
    shopItems: document.getElementById('shop-items'),
    titleMissions: document.getElementById('title-missions'),
    pauseMissions: document.getElementById('pause-missions'),
    verify: document.getElementById('verify'),
  };
}

export function missionListHtml(G, missions) {
  return missions.map((m) => {
    const done = G.missionsDone[m.id];
    return '<div class="mrow' + (done ? ' done' : '') + '"><span class="mname">' + (done ? '✓ ' : '○ ') + m.name +
      '</span><span class="mdesc">' + m.desc + '</span><span class="mpay">' + fmtCash(m.payout) + '</span></div>';
  }).join('');
}

function drawMinimap(H, G) {
  const c = H.minimap.getContext('2d');
  const W = 210;
  const Hh = 150;
  const sx = W / WORLD_W;
  const sy = Hh / WORLD_H;
  c.clearRect(0, 0, W, Hh);
  // Sea + sand.
  c.fillStyle = '#14608f';
  c.fillRect(SEA_X * sx, 0, W - SEA_X * sx, Hh);
  c.fillStyle = '#e8c98f';
  c.fillRect(BEACH_X * sx, 0, (SEA_X - BEACH_X) * sx, Hh);
  // Land.
  c.fillStyle = '#2c332a';
  c.fillRect(0, 0, BEACH_X * sx, Hh);
  // Roads.
  c.strokeStyle = '#8a8a96';
  c.lineWidth = 2;
  for (const x of STREETS_X) {
    c.beginPath();
    c.moveTo(x * sx, 0);
    c.lineTo(x * sx, Hh);
    c.stroke();
  }
  for (const y of STREETS_Y) {
    c.beginPath();
    c.moveTo(0, y * sy);
    c.lineTo(W, y * sy);
    c.stroke();
  }
  // Buildings.
  c.fillStyle = '#5b4a68';
  for (const b of G.city.buildings) {
    c.fillRect(b.x * sx, b.y * sy, Math.max(1.5, b.w * sx), Math.max(1.5, b.h * sy));
  }
  // Pier.
  c.strokeStyle = '#8f6b45';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(3180 * sx, 1200 * sy);
  c.lineTo(3500 * sx, 1200 * sy);
  c.stroke();
  // Mission starts.
  c.fillStyle = '#ffe600';
  c.font = 'bold 11px system-ui, sans-serif';
  c.textAlign = 'center';
  for (const m of G.missionDefs) {
    if (G.missionsDone[m.id] || G.mission) continue;
    c.fillText('!', m.start.x * sx, m.start.y * sy + 4);
  }
  // Current objective.
  const obj = currentObjective(G);
  if (obj && obj.x !== undefined) {
    const pulse = 4 + 2 * Math.sin(G.time * 6);
    c.fillStyle = '#00ffa3';
    c.beginPath();
    c.arc(obj.x * sx, obj.y * sy, pulse, 0, Math.PI * 2);
    c.fill();
  }
  // Police.
  c.fillStyle = '#ff2020';
  for (const car of G.cars) {
    if (!car.police || car.dead) continue;
    c.beginPath();
    c.arc(car.x * sx, car.y * sy, 3, 0, Math.PI * 2);
    c.fill();
  }
  // Player arrow.
  const px = G.player.x * sx;
  const py = G.player.y * sy;
  c.save();
  c.translate(px, py);
  c.rotate(G.player.angle);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(7, 0);
  c.lineTo(-5, -5);
  c.lineTo(-5, 5);
  c.closePath();
  c.fill();
  c.restore();
  // North + border.
  c.strokeStyle = 'rgba(255,255,255,0.5)';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, W - 1, Hh - 1);
}

export function updateHud(H, G, dt) {
  // Mission box.
  if (G.mission) {
    const obj = currentObjective(G);
    H.missionName.textContent = G.mission.def.name + ' — ' + fmtCash(G.mission.def.payout);
    H.missionObj.textContent = (obj ? obj.text : '') + ' · ' + missionStageText(G);
    H.missionTimer.textContent = G.mission.def.time > 0 ? '⏱ ' + fmtTime(G.mission.timer) : '';
  } else {
    H.missionName.textContent = 'Free roam — find a yellow ! to start a job';
    H.missionObj.textContent = Object.keys(G.missionsDone).length + ' / 6 jobs done · ' + fmtCash(G.player.cash);
    H.missionTimer.textContent = '';
  }
  // Cash + clock + stars.
  H.cash.textContent = fmtCash(G.player.cash);
  H.clock.textContent = fmtClock(G.clock);
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < G.wanted ? '★' : '☆';
  H.stars.textContent = stars;
  H.stars.style.color = G.wanted > 0 ? '#ff2e63' : 'rgba(255,255,255,0.45)';
  // Speed.
  const mph = G.player.car ? Math.round(Math.abs(G.player.car.speed) * 0.62) : Math.round(Math.abs(G.player.speed) * 0.62);
  H.speed.textContent = String(mph);
  H.carName.textContent = G.player.car ? G.player.car.def.name : 'On foot';
  // Vitals.
  H.healthFill.style.width = clamp(G.player.health, 0, 100) + '%';
  H.armorFill.style.width = clamp(G.player.armor, 0, 100) + '%';
  H.radioName.textContent = G.audio ? G.audio.stationName(G.radioStation) : 'Sunset FM';
  // Message.
  if (G.messageT > 0) {
    H.message.textContent = G.message;
    H.message.style.opacity = '1';
    G.messageT -= dt;
  } else {
    H.message.style.opacity = '0';
  }
  // Prompt.
  H.prompt.textContent = G.prompt || '';
  // Banner.
  if (G.state === 'busted' || G.state === 'wasted') {
    H.banner.textContent = G.state === 'busted' ? 'BUSTED' : 'WASTED';
    H.banner.style.opacity = '1';
  } else if (G.completedFlash > 0) {
    H.banner.textContent = 'JOB DONE';
    H.banner.style.opacity = '1';
    G.completedFlash -= dt;
  } else {
    H.banner.style.opacity = '0';
  }
  // Screens.
  H.titleScreen.style.display = G.state === 'title' ? 'flex' : 'none';
  H.pauseScreen.style.display = G.state === 'paused' ? 'flex' : 'none';
  H.shopPanel.style.display = G.shopOpen ? 'block' : 'none';
  drawMinimap(H, G);
}
