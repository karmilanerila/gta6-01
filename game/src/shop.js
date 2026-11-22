// Sunset Keys — the four shops: paint, arms, the car dealer and the Fixer.
// Written fresh for round 5.
import { dist, fmtCash } from './util.js';
import { VEHICLE_DEFS, makeVehicle } from './vehicles.js';

export const PAINTS = ['#ff2e63', '#ffb400', '#2ec4b6', '#7c4dff', '#00e5ff', '#ff9a3d', '#e8ecf2', '#1c1c22'];

export function nearestShop(G) {
  for (const s of G.city.shops) {
    if (dist(G.player.x, G.player.y, s.x, s.y) < s.r) return s;
  }
  return null;
}

// What a shop sells, as {label, price, can, buy} entries for the panel.
export function shopItems(G, shop) {
  const p = G.player;
  if (shop.id === 'paint') {
    return [
      {
        label: 'Repaint your car — ' + PAINTS.length + ' colours, one at a time',
        price: 300,
        can: !!p.car,
        why: p.car ? '' : 'You need to be in a car',
        buy: () => {
          const i = PAINTS.indexOf(p.car.color);
          const next = PAINTS[(i + 1) % PAINTS.length];
          p.car.color = next;
          G.paint = next;
          return 'Fresh paint: ' + next;
        },
      },
      {
        label: 'Full repair — your car back to showroom condition',
        price: 250,
        can: !!p.car && p.car.hp < p.car.maxHp,
        why: !p.car ? 'You need to be in a car' : p.car.hp >= p.car.maxHp ? 'Your car is already pristine' : '',
        buy: () => {
          p.car.hp = p.car.maxHp;
          p.car.dead = false;
          return 'Repaired to full health';
        },
      },
    ];
  }
  if (shop.id === 'arms') {
    return [
      {
        label: 'Body armor (+50)',
        price: 400,
        can: p.armor < 100,
        why: p.armor >= 100 ? 'Armor is full' : '',
        buy: () => { p.armor = Math.min(100, p.armor + 50); return 'Armor fitted'; },
      },
      {
        label: 'Pistol (click to shoot)',
        price: 600,
        can: !G.weapon,
        why: G.weapon ? 'You already own one' : '',
        buy: () => { G.weapon = true; return 'Pistol bought — click to shoot'; },
      },
    ];
  }
  if (shop.id === 'dealer') {
    return Object.values(VEHICLE_DEFS)
      .filter((d) => d.price > 0)
      .map((d) => ({
        label: d.name + ' — ' + d.blurb,
        price: d.price,
        can: !G.owned[d.id],
        why: G.owned[d.id] ? 'Already yours' : '',
        buy: () => {
          G.owned[d.id] = true;
          const car = makeVehicle(d.id, 800, 980, 0, { color: d.color });
          G.cars.push(car);
          return d.name + ' is parked outside the dealer';
        },
      }));
  }
  // The Fixer.
  return [{
    label: 'Clean record — wipe your wanted level',
    price: 500 * G.wanted,
    can: G.wanted > 0,
    why: G.wanted > 0 ? '' : 'You are clean already',
    buy: () => {
      G.wanted = 0;
      return 'The patrol forgot your face';
    },
  }];
}

export function buyFromShop(G, shop, index) {
  const items = shopItems(G, shop);
  const item = items[index];
  if (!item || !item.can) return false;
  if (G.player.cash < item.price) {
    G.message = 'Not enough cash — you need ' + fmtCash(item.price);
    G.messageT = 2.5;
    return false;
  }
  G.player.cash -= item.price;
  const result = item.buy();
  G.message = result + ' (−' + fmtCash(item.price) + ')';
  G.messageT = 3;
  if (G.audio) G.audio.jingle('checkpoint');
  return true;
}
