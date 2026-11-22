// Sunset Keys — particles, skid marks and screen shake. Written fresh for round 5.
import { rand, clamp } from './util.js';

export function makeParticles() {
  return { list: [], skids: [], shake: 0, shakeX: 0, shakeY: 0 };
}

export function addShake(P, amount) {
  P.shake = Math.min(18, P.shake + amount);
}

export function spawnSmoke(P, x, y, n, color) {
  for (let i = 0; i < n; i++) {
    P.list.push({
      kind: 'smoke', x: x + rand(Math.random, -6, 6), y: y + rand(Math.random, -6, 6),
      vx: rand(Math.random, -22, 22), vy: rand(Math.random, -26, -4),
      life: rand(Math.random, 0.5, 1.1), max: 1.1, size: rand(Math.random, 7, 15),
      color: color || 'rgba(200,200,200,0.5)',
    });
  }
}

export function spawnSparks(P, x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(Math.random, 0, Math.PI * 2);
    const sp = rand(Math.random, 90, 320);
    P.list.push({
      kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(Math.random, 0.15, 0.45), max: 0.45, size: rand(Math.random, 1.5, 3),
      color: '#ffd94d',
    });
  }
}

export function spawnSpray(P, x, y, n) {
  for (let i = 0; i < n; i++) {
    P.list.push({
      kind: 'spray', x: x + rand(Math.random, -10, 10), y: y + rand(Math.random, -6, 6),
      vx: rand(Math.random, -40, 40), vy: rand(Math.random, 40, 130),
      life: rand(Math.random, 0.3, 0.7), max: 0.7, size: rand(Math.random, 2, 5),
      color: 'rgba(180,220,255,0.8)',
    });
  }
}

export function spawnBurst(P, x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(Math.random, 0, Math.PI * 2);
    const sp = rand(Math.random, 60, 260);
    P.list.push({
      kind: 'burst', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(Math.random, 0.3, 0.8), max: 0.8, size: rand(Math.random, 2, 5),
      color: color || '#ff5e7a',
    });
  }
}

// An expanding ring, used when a checkpoint or buoy is reached.
export function spawnRing(P, x, y, color) {
  P.list.push({
    kind: 'ring', x, y, vx: 0, vy: 0,
    life: 0.6, max: 0.6, size: 10, color: color || '#00ffa3',
  });
}

export function addSkid(P, x1, y1, x2, y2) {
  P.skids.push({ x1, y1, x2, y2, life: 5 });
  if (P.skids.length > 240) P.skids.shift();
}

export function updateParticles(P, dt) {
  for (const p of P.list) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 1.6 * dt;
    p.vy *= 1 - 1.6 * dt;
    p.life -= dt;
  }
  P.list = P.list.filter((p) => p.life > 0);
  for (const s of P.skids) s.life -= dt;
  P.skids = P.skids.filter((s) => s.life > 0);
  P.shake = Math.max(0, P.shake - 30 * dt);
  P.shakeX = (Math.random() - 0.5) * P.shake;
  P.shakeY = (Math.random() - 0.5) * P.shake;
}

export function drawParticles(ctx, P) {
  // Skid marks first (under everything else that moves).
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of P.skids) {
    ctx.strokeStyle = 'rgba(10,10,14,' + clamp(s.life / 5, 0, 1) * 0.55 + ')';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.restore();
  for (const p of P.list) {
    const t = clamp(p.life / p.max, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    if (p.kind === 'smoke') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'spark') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // Expanding rings.
  for (const p of P.list) {
    if (p.kind !== 'ring') continue;
    const t = clamp(p.life / p.max, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size + (1 - t) * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
