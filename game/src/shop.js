// Shops: cash finally does something. Two store fronts with beacon markers —
// AMMO-NATION (ammo + armor, on foot) and MOD SHOP (car repair + nitro, in
// a car). Walk or drive into the marker and the shop opens. Plain DOM
// overlay, no assets.
import * as THREE from '../vendor/three.module.min.js';
import { WEAPONS } from './world.js';

const OPEN_RADIUS = 6;
const CLOSE_RADIUS = 8;

function makeShopBeacon(color) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.7, 26, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 13;
  group.add(beam);
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.2),
    new THREE.MeshBasicMaterial({ color }),
  );
  marker.position.y = 3.2;
  group.add(marker);
  return { group, marker };
}

const STORES = [
  {
    id: 'ammo', name: 'AMMO-NATION', x: 124, z: -112, color: 0x2eff7a, css: '#2eff7a',
    blurb: 'Guns, ammo, armor. No questions asked.',
    items: [
      {
        id: 'pistol', name: 'Pistol ammo +60', price: 150,
        canBuy: (w) => w.player.ammo[1] < WEAPONS[1].ammo * 2,
        apply: (w) => { w.player.ammo[1] = Math.min(WEAPONS[1].ammo * 2, w.player.ammo[1] + 60); },
      },
      {
        id: 'smg', name: 'SMG ammo +150', price: 250,
        canBuy: (w) => w.player.ammo[2] < WEAPONS[2].ammo * 2,
        apply: (w) => { w.player.ammo[2] = Math.min(WEAPONS[2].ammo * 2, w.player.ammo[2] + 150); },
      },
      {
        id: 'shotgun', name: 'Shotgun shells +28', price: 200,
        canBuy: (w) => w.player.ammo[3] < WEAPONS[3].ammo * 2,
        apply: (w) => { w.player.ammo[3] = Math.min(WEAPONS[3].ammo * 2, w.player.ammo[3] + 28); },
      },
      {
        id: 'armor', name: 'Body armor +50', price: 300,
        canBuy: (w) => w.player.armor < 100,
        apply: (w) => { w.player.armor = Math.min(100, w.player.armor + 50); },
      },
    ],
  },
  {
    id: 'mod', name: 'MOD SHOP', x: -35, z: 45, color: 0xff9d2e, css: '#ff9d2e',
    blurb: 'Repairs, nitro, plating. Drive in, drive out better.',
    items: [
      {
        id: 'repair', name: 'Repair car to 100%', price: 400,
        canBuy: (w) => !!w.player.vehicle && !w.player.vehicle.dead && w.player.vehicle.health < 100,
        apply: (w) => { if (w.player.vehicle) w.player.vehicle.health = 100; },
      },
      {
        id: 'nitro', name: 'Nitro refill 100%', price: 150,
        canBuy: (w) => !!w.player.vehicle && w.player.vehicle.def.nitro && w.player.vehicle.nitroFuel < 100,
        apply: (w) => { if (w.player.vehicle) w.player.vehicle.nitroFuel = 100; },
      },
      {
        id: 'plating', name: 'Armor plating +50', price: 300,
        canBuy: (w) => w.player.armor < 100,
        apply: (w) => { w.player.armor = Math.min(100, w.player.armor + 50); },
      },
    ],
  },
];

export function createShop(scene, world, city, audio, hooks) {
  const beacons = STORES.map((s) => {
    const b = makeShopBeacon(s.color);
    b.group.position.set(s.x, 0, s.z);
    scene.add(b.group);
    return b;
  });
  const s = {
    openStore: null,
    overlay: null,
    cooldown: 0,
    time: 0,
  };

  function closeShop() {
    if (s.overlay) {
      s.overlay.remove();
      s.overlay = null;
    }
    s.openStore = null;
    s.cooldown = 2;
  }

  function buy(item) {
    if (!s.openStore) return;
    if (world.cash < item.price) {
      if (hooks.onToast) hooks.onToast('Not enough cash — $' + item.price + ' needed');
      audio.blip();
      return;
    }
    if (!item.canBuy(world)) {
      if (hooks.onToast) hooks.onToast('Already maxed out');
      audio.blip();
      return;
    }
    world.cash -= item.price;
    item.apply(world);
    audio.cash();
    if (hooks.onToast) hooks.onToast('Bought: ' + item.name + ' (-$' + item.price + ')');
    renderOverlay();
  }

  function renderOverlay() {
    if (!s.overlay || !s.openStore) return;
    const store = s.openStore;
    const root = document.getElementById('hud');
    if (!root) return;
    // Rebuild the panel content (cash and button states change on purchase).
    s.overlay.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = store.name;
    title.style.cssText = 'font-family:\'Arial Black\',Arial,sans-serif;font-size:22px;color:' + store.css + ';letter-spacing:2px;text-align:center;';
    s.overlay.appendChild(title);
    const blurb = document.createElement('div');
    blurb.textContent = store.blurb;
    blurb.style.cssText = 'font-size:13px;color:#c8c8d8;text-align:center;margin:4px 0 8px;';
    s.overlay.appendChild(blurb);
    const cash = document.createElement('div');
    cash.textContent = 'CASH: $' + world.cash.toLocaleString('en-US');
    cash.style.cssText = 'font-size:15px;color:#7dff9e;text-align:center;margin-bottom:10px;';
    s.overlay.appendChild(cash);
    for (const item of store.items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 4px;border-top:1px solid rgba(255,255,255,0.12);';
      const name = document.createElement('span');
      name.textContent = item.name;
      name.style.cssText = 'font-size:14px;color:#ffe9f6;';
      row.appendChild(name);
      const btn = document.createElement('button');
      const afford = world.cash >= item.price;
      const usable = item.canBuy(world);
      // Car items need a car: say so instead of a misleading "MAX".
      const needsCar = (item.id === 'repair' || item.id === 'nitro') && !world.player.vehicle;
      btn.textContent = needsCar ? 'NO CAR' : (!usable ? 'MAX' : '$' + item.price);
      btn.disabled = needsCar || !afford || !usable;
      btn.style.cssText = 'font-family:\'Arial Black\',Arial,sans-serif;font-size:13px;color:#fff;'
        + 'background:' + (btn.disabled ? '#444' : 'linear-gradient(180deg,#ff2e88,#c40e66)') + ';'
        + 'border:1px solid #ffd166;border-radius:6px;padding:6px 14px;cursor:' + (btn.disabled ? 'default' : 'pointer') + ';';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        buy(item);
      });
      row.appendChild(btn);
      s.overlay.appendChild(row);
    }
    const close = document.createElement('button');
    close.textContent = 'CLOSE  ✕';
    close.style.cssText = 'display:block;margin:12px auto 0;font-family:\'Arial Black\',Arial,sans-serif;font-size:13px;'
      + 'color:#fff;background:#333;border:1px solid #888;border-radius:6px;padding:7px 20px;cursor:pointer;';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeShop();
    });
    s.overlay.appendChild(close);
  }

  function openShop(store) {
    const root = document.getElementById('hud');
    if (!root) return;
    s.openStore = store;
    const panel = document.createElement('div');
    panel.id = 'shop-panel';
    panel.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;'
      + 'background:rgba(10,10,30,0.94);border:1px solid ' + store.css + ';border-radius:10px;'
      + 'padding:16px 18px;pointer-events:auto;font-family:Arial,sans-serif;z-index:25;';
    s.overlay = panel;
    root.appendChild(panel);
    if (document.pointerLockElement) document.exitPointerLock();
    renderOverlay();
    audio.blip();
  }

  // Minimap markers for the two store fronts.
  s.getMarkers = () => STORES.map((st) => ({ x: st.x, z: st.z, color: st.css, kind: 'shop' }));
  s.isOpen = () => !!s.openStore;

  s.update = (dt) => {
    s.time += dt;
    s.cooldown = Math.max(0, s.cooldown - dt);
    for (const b of beacons) {
      b.marker.rotation.y += dt * 1.6;
      b.marker.position.y = 3.2 + Math.sin(s.time * 2 + b.group.position.x) * 0.4;
    }
    const pp = world.playerPos();
    if (s.openStore) {
      // Close when the player walks/drives away from the store.
      const d = Math.hypot(pp.x - s.openStore.x, pp.z - s.openStore.z);
      if (d > CLOSE_RADIUS) closeShop();
      return;
    }
    if (s.cooldown > 0) return;
    const p = world.player;
    for (const store of STORES) {
      const d = Math.hypot(pp.x - store.x, pp.z - store.z);
      if (d > OPEN_RADIUS) continue;
      // On foot, or in a car that is nearly stopped (drive-in garage).
      if (!p.vehicle) {
        openShop(store);
        return;
      }
      if (Math.abs(p.vehicle.speed) < 3) {
        openShop(store);
        return;
      }
    }
  };

  return s;
}
