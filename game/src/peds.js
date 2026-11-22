// Sunset Keys — pedestrians: islanders strolling the sidewalks, fleeing danger.
// Written fresh for round 5.
import { clamp, wrapAngle, angleTo, dist, rand, pick, mulberry32 } from './util.js';
import { STREETS_X, STREETS_Y, isOnRoad, isBeach, isWater } from './city.js';
import { addWanted } from './police.js';

const SHIRTS = ['#ff5e7a', '#ffe600', '#00e5ff', '#7c4dff', '#ff9a3d', '#4fc98a', '#e8ecf2', '#ff2e88'];

// True when a fast car is close enough to scare a pedestrian.
function dangerNearby(G, p) {
  for (const car of G.cars) {
    if (car.dead) continue;
    if (dist(p.x, p.y, car.x, car.y) < 170 && car.speed > 60) return car;
  }
  return null;
}

export function spawnPeds(G, n) {
  const rng = mulberry32(4242);
  for (let i = 0; i < n; i++) {
    const sx = pick(rng, STREETS_X);
    const sy = pick(rng, STREETS_Y);
    const onX = rng() < 0.5;
    const x = onX ? sx + (rng() < 0.5 ? -56 : 56) : rand(rng, 100, 3000);
    const y = onX ? rand(rng, 100, 2200) : sy + (rng() < 0.5 ? -56 : 56);
    G.peds.push({
      x, y, angle: rand(rng, 0, Math.PI * 2),
      speed: rand(rng, 26, 48),
      state: 'walk',
      shirt: pick(rng, SHIRTS),
      wander: rand(rng, 4, 12),
      downT: 0,
      id: 'p' + i,
    });
  }
  // A few sunbathers lounge on the sand and never wander off it.
  for (let i = 0; i < 5; i++) {
    G.peds.push({
      x: rand(rng, 3080, 3170), y: rand(rng, 200, 2200),
      angle: rand(rng, 0, Math.PI * 2), speed: 0,
      state: 'sunbathe', shirt: pick(rng, SHIRTS),
      wander: 999, downT: 0, id: 's' + i,
    });
  }
}

export function updatePeds(G, dt) {
  const px = G.player.x;
  const py = G.player.y;
  const playerCar = G.player.car;
  for (const p of G.peds) {
    if (p.state === 'down') {
      p.downT -= dt;
      if (p.downT <= 0) {
        p.state = 'flee';
        p.wander = 3;
      }
      continue;
    }
    // Sunbathers lounge on the sand and never wander off it.
    if (p.state === 'sunbathe') {
      if (dangerNearby(G, p)) {
        p.state = 'flee';
        p.wander = 3;
      }
      continue;
    }
    // Danger: a fast car nearby, or the player's car close.
    const danger = dangerNearby(G, p);
    if (danger) {
      p.state = 'flee';
      p.angle = angleTo(danger.x, danger.y, p.x, p.y);
      p.speed = 130;
    } else if (p.state === 'flee') {
      p.speed = 110;
      p.wander -= dt;
      if (p.wander <= 0) {
        p.state = 'walk';
        p.speed = rand(Math.random, 26, 48);
      }
    } else {
      p.wander -= dt;
      if (p.wander <= 0) {
        p.angle = rand(Math.random, 0, Math.PI * 2);
        p.wander = rand(Math.random, 4, 12);
      }
      // Keep peds near sidewalks and off the water.
      if (isWater(p.x, p.y)) {
        p.angle = angleTo(p.x, p.y, 1600, 1200);
      }
    }
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;
    p.x = clamp(p.x, 60, 3150);
    p.y = clamp(p.y, 60, 2340);

    // Hit by a car: knocked down, and the law notices.
    for (const car of G.cars) {
      if (car.dead) continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < 30 && car.speed > 70) {
        p.state = 'down';
        p.downT = 4;
        if (car === playerCar) {
          addWanted(G, 1, 'You ran over a pedestrian');
          G.player.cash = Math.max(0, G.player.cash - 50);
        }
        break;
      }
    }
  }
}

export function drawPeds(ctx, G, view) {
  for (const p of G.peds) {
    if (p.x < view.x0 - 20 || p.x > view.x1 + 20 || p.y < view.y0 - 20 || p.y > view.y1 + 20) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.state === 'down') {
      // Lying flat.
      ctx.rotate(p.angle);
      ctx.fillStyle = p.shirt;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c39a';
      ctx.beginPath();
      ctx.arc(12, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const bob = Math.sin(G.time * 8 + p.x) * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 3, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.shirt;
      ctx.beginPath();
      ctx.arc(0, bob * 0.3, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c39a';
      ctx.beginPath();
      ctx.arc(0, -2 + bob * 0.3, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Facing tick.
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(p.angle) * 9, Math.sin(p.angle) * 9);
      ctx.stroke();
    }
    ctx.restore();
  }
}
