// Sunset Keys — boot, the game loop, keyboard/mouse input and the save.
// Written fresh for round 5.
import { createGame, updateGame, drawGame } from './world.js';
import { stageShot, createVerify, verifyStep } from './shots.js';
import { missionListHtml, updateHud } from './hud.js';
import { MISSIONS } from './missions.js';
import { nearestShop, shopItems, buyFromShop } from './shop.js';
import { saveGame } from './police.js';

const canvas = document.getElementById('game');
const G = createGame(canvas);

const input = {
  up: false, down: false, left: false, right: false,
  sprint: false, handbrake: false, nitro: false,
  enter: false, enterMission: false, shoot: false,
  mouseX: 0, mouseY: 0,
};

let verify = null;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
}

window.addEventListener('resize', resize);
resize();

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'handbrake',
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  const mapped = KEYMAP[e.code];
  if (mapped) input[mapped] = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.nitro = true;
  if (e.repeat) return;
  if (e.code === 'Enter') {
    if (G.state === 'title') {
      G.state = 'playing';
      G.audio.ensure();
    }
  }
  if (e.code === 'Escape') {
    if (G.shopOpen) {
      closeShop();
    } else if (G.state === 'playing') {
      G.state = 'paused';
      G.hud.pauseMissions.innerHTML = missionListHtml(G, MISSIONS);
    } else if (G.state === 'paused') {
      G.state = 'playing';
    }
  }
  if (e.code === 'KeyE') {
    if (G.state !== 'playing') return;
    if (G.shopOpen) {
      closeShop();
      return;
    }
    const shop = nearestShop(G);
    if (shop) {
      openShop(shop);
      return;
    }
    // Mission start takes priority over getting in a car when both overlap.
    const nearMission = !G.mission && MISSIONS.some((m) => !G.missionsDone[m.id] && Math.hypot(G.player.x - m.start.x, G.player.y - m.start.y) < 90);
    if (nearMission) input.enterMission = true;
    else input.enter = true;
  }
  if (e.code === 'KeyR') {
    G.radioStation = (G.radioStation + 1) % 2;
    if (G.audio) {
      G.audio.ensure();
      G.audio.setStation(G.radioStation);
    }
    G.message = 'Radio: ' + (G.audio ? G.audio.stationName(G.radioStation) : 'Sunset FM');
    G.messageT = 2;
  }
  if (e.code === 'KeyM') {
    if (G.audio) {
      G.audio.ensure();
      const muted = G.audio.toggleMute();
      G.message = muted ? 'Muted' : 'Sound on';
      G.messageT = 1.5;
    }
  }
  if (e.code === 'KeyH') {
    if (G.state === 'playing' && G.audio) {
      G.audio.ensure();
      G.audio.horn();
    }
  }
});

window.addEventListener('keyup', (e) => {
  const mapped = KEYMAP[e.code];
  if (mapped) input[mapped] = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.nitro = false;
});

canvas.addEventListener('mousedown', (e) => {
  if (G.state !== 'playing') return;
  G.audio.ensure();
  input.shoot = true;
  input.mouseX = e.clientX;
  input.mouseY = e.clientY;
});

function openShop(shop) {
  G.shopOpen = shop.id;
  G.shop = shop;
  G.hud.shopTitle.textContent = shop.name;
  renderShopItems();
}

function closeShop() {
  G.shopOpen = null;
  G.shop = null;
}

function renderShopItems() {
  const shop = G.shop;
  if (!shop) return;
  const items = shopItems(G, shop);
  G.hud.shopItems.innerHTML = items.map((it, i) => {
    const afford = G.player.cash >= it.price;
    const dis = !it.can || !afford;
    const note = !it.can ? (it.why || 'Unavailable') : !afford ? 'Not enough cash' : '';
    return '<div class="shop-item' + (dis ? ' disabled' : '') + '" data-i="' + i + '">' +
      '<div class="shop-label">' + it.label + '</div>' +
      '<div class="shop-price">$' + it.price.toLocaleString('en-US') + '</div>' +
      (note ? '<div class="shop-note">' + note + '</div>' : '') + '</div>';
  }).join('');
  const nodes = G.hud.shopItems.querySelectorAll('.shop-item');
  nodes.forEach((n) => {
    n.addEventListener('click', () => {
      const i = Number(n.getAttribute('data-i'));
      if (buyFromShop(G, shop, i)) {
        renderShopItems();
        G.hud.titleMissions.innerHTML = missionListHtml(G, MISSIONS);
      }
    });
  });
}

// URL modes: ?shot=cover|downtown|heist|boat stages a scene; ?verify=1 self-checks.
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const verifyMode = params.get('verify') === '1';
if (shot) {
  stageShot(G, shot);
} else if (verifyMode) {
  G.verifyMode = true;
  G.state = 'playing';
  verify = createVerify();
  // No audio in the self-check: there is no user gesture, so the context
  // would stay suspended and spam the console with warnings.
} else if (params.get('quick') === '1') {
  G.state = 'playing';
  G.audio.ensure();
}

window.addEventListener('error', (e) => {
  const el = document.getElementById('verify');
  if (el) el.textContent += '\nJS ERROR: ' + (e.message || e.type);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (verify) {
    // The self-check drives the game itself: feed it the verify input.
    const vi = G.verifyInput || input;
    if (G.verifyInput) updateGame(G, G.verifyInput, dt);
    else updateGame(G, input, dt);
    verifyStep(G, verify, dt);
    if (verify.done) {
      drawGame(G);
      updateHud(G.hud, G, dt);
      return; // Stop the loop; the DOM holds the results.
    }
  } else {
    updateGame(G, input, dt);
  }
  drawGame(G);
  updateHud(G.hud, G, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Keep the save fresh when the tab closes.
window.addEventListener('beforeunload', () => saveGame(G));

// Expose the game for debugging and for the verification harness.
window.__SK = { G, input };
