// Sunset Keys — the city of Coral Bay Keys: layout, collision and drawing.
// A coastal archipelago: a street grid, a beach and sea on the east, a pier, a marina,
// a neon downtown and a highway ring. Written fresh for round 5.
import { mulberry32, rand, randInt, pick, clamp, circleVsRect } from './util.js';

export const WORLD_W = 3600;
export const WORLD_H = 2400;
export const SEA_X = 3200; // east of this is open water
export const BEACH_X = 3040; // sand strip between the last street and the sea
export const PIER_Y = 1200;
export const PIER_X0 = 3180;
export const PIER_X1 = 3500;

export const STREETS_X = [400, 800, 1200, 1600, 2000, 2400, 2800];
export const STREETS_Y = [300, 600, 900, 1200, 1500, 1800, 2100];
export const ROAD_HALF = 45;
export const HIGHWAY_HALF = 68;

export function isHighwayX(x) {
  return x === 400 || x === 2800;
}
export function isHighwayY(y) {
  return y === 300 || y === 2100;
}
export function roadHalfAt(x, y) {
  return isHighwayX(x) || isHighwayY(y) ? HIGHWAY_HALF : ROAD_HALF;
}

export function isWater(x, y) {
  if (x > SEA_X) return true;
  // Marina basin: a dredged channel at the south-east corner.
  if (x > 2850 && y > 2050 && x < SEA_X && y < 2350) return true;
  return false;
}

export function isBeach(x, y) {
  return x >= BEACH_X && x <= SEA_X && !isWater(x, y);
}

export function isOnRoad(x, y) {
  for (const sx of STREETS_X) {
    if (Math.abs(x - sx) <= roadHalfAt(sx, y)) return true;
  }
  for (const sy of STREETS_Y) {
    if (Math.abs(y - sy) <= roadHalfAt(x, sy)) return true;
  }
  return false;
}

// Every intersection, for traffic routing and mission waypoints.
export function buildIntersections() {
  const pts = [];
  for (const x of STREETS_X) {
    for (const y of STREETS_Y) {
      pts.push({ x, y });
    }
  }
  return pts;
}

export function nearestIntersection(x, y) {
  let best = null;
  let bd = Infinity;
  for (const sx of STREETS_X) {
    for (const sy of STREETS_Y) {
      const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (d < bd) {
        bd = d;
        best = { x: sx, y: sy };
      }
    }
  }
  return best;
}

// The nearest point on any road centreline to (x, y) — used to keep traffic
// and stray cars on the streets instead of cutting across blocks.
export function nearestRoadPoint(x, y) {
  let best = { x: STREETS_X[0], y, d: Infinity };
  for (const sx of STREETS_X) {
    const d = Math.abs(x - sx);
    if (d < best.d) best = { x: sx, y: clamp(y, 0, WORLD_H), d };
  }
  for (const sy of STREETS_Y) {
    const d = Math.abs(y - sy);
    if (d < best.d) best = { x: clamp(x, 0, WORLD_W), y: sy, d };
  }
  return best;
}

// A downtown block is one of the four blocks around the city centre.
export function isDowntown(x, y) {
  return x >= 1200 && x <= 2400 && y >= 900 && y <= 1500;
}

export function buildCity() {
  const rng = mulberry32(20261122);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parks = [];

  const blockColors = ['#5b4a68', '#6b5560', '#4d5a6e', '#63505a', '#54604f', '#6e5a44'];
  const neonColors = ['#ff2e88', '#00e5ff', '#ffe600', '#7c4dff', '#00ffa3'];

  // Blocks: between neighbouring streets. Skip the marina basin and the beach strip.
  for (let ix = 0; ix < STREETS_X.length - 1; ix++) {
    for (let iy = 0; iy < STREETS_Y.length - 1; iy++) {
      const x0 = STREETS_X[ix] + ROAD_HALF + 14;
      const x1 = STREETS_X[ix + 1] - ROAD_HALF - 14;
      const y0 = STREETS_Y[iy] + ROAD_HALF + 14;
      const y1 = STREETS_Y[iy + 1] - ROAD_HALF - 14;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const downtown = isDowntown(cx, cy);
      // The south-east blocks are the marina basin, not buildings.
      if (x0 > 2800 && y0 > 1950) continue;
      // A few blocks are parks.
      if (rng() < 0.16 && !downtown) {
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        for (let t = 0; t < 7; t++) {
          trees.push({ x: rand(rng, x0 + 20, x1 - 20), y: rand(rng, y0 + 20, y1 - 20), r: rand(rng, 9, 15) });
        }
        continue;
      }
      const n = downtown ? randInt(rng, 2, 3) : randInt(rng, 1, 3);
      for (let b = 0; b < n; b++) {
        const bw = downtown ? rand(rng, 90, 150) : rand(rng, 70, 130);
        const bh = downtown ? rand(rng, 90, 150) : rand(rng, 60, 110);
        const bx = rand(rng, x0 + 8, Math.max(x0 + 9, x1 - bw - 8));
        const by = rand(rng, y0 + 8, Math.max(y0 + 9, y1 - bh - 8));
        buildings.push({
          x: bx, y: by, w: bw, h: bh,
          color: pick(rng, blockColors),
          tall: downtown && rng() < 0.7,
          neon: downtown && rng() < 0.55 ? pick(rng, neonColors) : null,
          name: downtown ? pick(rng, ['SOLMAR', 'PALMS', 'CORAL', 'NEON', 'KEYS', 'TIDE']) : null,
        });
      }
      // Street trees along the block edges.
      for (let t = 0; t < 3; t++) {
        trees.push({ x: rand(rng, x0, x1), y: y0 + 6, r: rand(rng, 8, 12) });
      }
    }
  }

  // Palm trees along the beach.
  for (let y = 80; y < WORLD_H - 80; y += 90) {
    trees.push({ x: rand(rng, BEACH_X + 30, BEACH_X + 90), y: y + rand(rng, -20, 20), r: rand(rng, 10, 14), palm: true });
  }
  // Street lamps at intersections.
  for (const sx of STREETS_X) {
    for (const sy of STREETS_Y) {
      lamps.push({ x: sx + ROAD_HALF + 8, y: sy - ROAD_HALF - 8 });
    }
  }

  const shops = [
    { id: 'paint', name: 'Sunset Paint', x: 1200, y: 252, r: 70, color: '#ff2e88' },
    { id: 'arms', name: 'Key Arms', x: 2000, y: 1848, r: 70, color: '#ffb400' },
    { id: 'dealer', name: 'Marina Motors', x: 800, y: 852, r: 80, color: '#00e5ff' },
    { id: 'fixer', name: 'The Fixer', x: 1600, y: 2148, r: 70, color: '#7c4dff' },
  ];

  const city = {
    buildings, trees, lamps, parks, shops,
    intersections: buildIntersections(),
    marina: { x: 2960, y: 2180, w: 220, h: 130 },
    safehouse: { x: 900, y: 300, r: 80 },
    hospital: { x: 2400, y: 600, r: 80 },
    pier: { x0: PIER_X0, x1: PIER_X1, y: PIER_Y, w: 64 },
    spawn: { x: 1200, y: 1200, angle: 0 },
    boatDock: { x: 3300, y: 1850 },
  };
  return city;
}

// Push a circle out of every building it overlaps. Returns true when it hit something.
export function collideBuildings(city, pos, r) {
  let hit = false;
  for (const b of city.buildings) {
    const out = circleVsRect(pos.x, pos.y, r, b.x, b.y, b.w, b.h);
    if (out) {
      pos.x = out.x;
      pos.y = out.y;
      hit = true;
    }
  }
  return hit;
}

// Sky and light for a given clock hour (0-24). Sunset starts at 17:30.
export function skyFor(clock) {
  const h = ((clock % 24) + 24) % 24;
  if (h >= 16.5 && h < 18.5) {
    const t = (h - 16.5) / 2;
    return { top: '#ff9a3d', mid: '#ff5e7a', ground: '#3d2b4d', night: t * 0.35, sun: 1 - t * 0.4, label: 'Golden hour' };
  }
  if (h >= 18.5 && h < 20.5) {
    const t = (h - 18.5) / 2;
    return { top: '#7a3d8f', mid: '#c94b7a', ground: '#241a33', night: 0.35 + t * 0.45, sun: 0.6 - t * 0.6, label: 'Dusk' };
  }
  if (h >= 20.5 || h < 5.5) {
    return { top: '#0d1030', mid: '#1c1440', ground: '#120e22', night: 1, sun: 0, label: 'Night' };
  }
  if (h >= 5.5 && h < 7.5) {
    const t = (h - 5.5) / 2;
    return { top: '#ff9a6b', mid: '#ffb38a', ground: '#3a2f45', night: 0.8 - t * 0.5, sun: t * 0.5, label: 'Dawn' };
  }
  return { top: '#7ec8e3', mid: '#aee3f5', ground: '#4a5a6a', night: 0, sun: 1, label: 'Day' };
}

// ---- drawing -------------------------------------------------------------

export function drawCity(ctx, city, G, view) {
  const { x0, y0, x1, y1 } = view;
  const sky = skyFor(G.clock);
  const night = sky.night;

  // Ground base.
  ctx.fillStyle = '#3f4a3a';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Sea (east) with slow waves.
  if (x1 > SEA_X) {
    const wave = Math.sin(G.time * 0.7) * 4;
    ctx.fillStyle = night > 0.5 ? '#0a1e3a' : '#14608f';
    ctx.fillRect(Math.max(x0, SEA_X), y0, x1 - Math.max(x0, SEA_X), y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    for (let wy = Math.floor(y0 / 90) * 90; wy < y1; wy += 90) {
      ctx.beginPath();
      ctx.moveTo(Math.max(x0, SEA_X) + 10, wy + wave);
      ctx.quadraticCurveTo(Math.max(x0, SEA_X) + 60, wy + wave + 8, Math.max(x0, SEA_X) + 130, wy + wave);
      ctx.stroke();
    }
    // Marina basin.
    ctx.fillStyle = night > 0.5 ? '#0d2342' : '#1a6d9e';
    ctx.fillRect(2850, 2050, SEA_X - 2850, 300);
  }

  // Beach sand.
  if (x1 > BEACH_X) {
    ctx.fillStyle = night > 0.5 ? '#8a7a5e' : '#e8c98f';
    ctx.fillRect(Math.max(x0, BEACH_X), y0, Math.min(x1, SEA_X) - Math.max(x0, BEACH_X), y1 - y0);
  }

  // Parks.
  for (const p of city.parks) {
    if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue;
    ctx.fillStyle = night > 0.5 ? '#1e3a24' : '#4d7a44';
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  // Roads.
  ctx.fillStyle = night > 0.5 ? '#1a1a22' : '#2e2e38';
  for (const sx of STREETS_X) {
    const hw = roadHalfAt(sx, 0);
    ctx.fillRect(sx - hw, y0, hw * 2, y1 - y0);
  }
  for (const sy of STREETS_Y) {
    const hw = roadHalfAt(0, sy);
    ctx.fillRect(x0, sy - hw, x1 - x0, hw * 2);
  }

  // Sidewalks.
  ctx.fillStyle = night > 0.5 ? '#2c2c38' : '#55555f';
  for (const sx of STREETS_X) {
    const hw = roadHalfAt(sx, 0);
    ctx.fillRect(sx - hw - 10, y0, 10, y1 - y0);
    ctx.fillRect(sx + hw, y0, 10, y1 - y0);
  }
  for (const sy of STREETS_Y) {
    const hw = roadHalfAt(0, sy);
    ctx.fillRect(x0, sy - hw - 10, x1 - x0, 10);
    ctx.fillRect(x0, sy + hw, x1 - x0, 10);
  }

  // Centre dashes.
  ctx.strokeStyle = night > 0.5 ? 'rgba(255,220,120,0.5)' : 'rgba(255,220,120,0.85)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 30]);
  for (const sx of STREETS_X) {
    ctx.beginPath();
    ctx.moveTo(sx, y0);
    ctx.lineTo(sx, y1);
    ctx.stroke();
  }
  for (const sy of STREETS_Y) {
    ctx.beginPath();
    ctx.moveTo(x0, sy);
    ctx.lineTo(x1, sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Pier.
  const pier = city.pier;
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(pier.x0, pier.y - pier.w / 2, pier.x1 - pier.x0, pier.w);
  ctx.fillStyle = '#8f6b45';
  for (let px = pier.x0 + 20; px < pier.x1; px += 44) {
    ctx.fillRect(px, pier.y - pier.w / 2, 3, pier.w);
  }
  // Pier end lights.
  ctx.fillStyle = '#ffe600';
  ctx.beginPath();
  ctx.arc(pier.x1 - 12, pier.y - pier.w / 2 + 8, 5, 0, Math.PI * 2);
  ctx.arc(pier.x1 - 12, pier.y + pier.w / 2 - 8, 5, 0, Math.PI * 2);
  ctx.fill();

  // Marina dock.
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(city.marina.x, city.marina.y, city.marina.w, city.marina.h);
  ctx.fillStyle = '#8f6b45';
  ctx.fillRect(city.marina.x, city.marina.y, city.marina.w, 10);

  // Buildings.
  for (const b of city.buildings) {
    if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Roof detail.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    if (b.tall) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(b.x + b.w, b.y + 10, 8, b.h - 20);
      ctx.fillRect(b.x + 10, b.y + b.h, b.w - 20, 8);
    }
    // Lit windows at night.
    if (night > 0.4) {
      ctx.fillStyle = 'rgba(255,214,120,0.85)';
      for (let wy = b.y + 12; wy < b.y + b.h - 10; wy += 18) {
        for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 18) {
          if ((wx * 7 + wy * 13) % 5 < 2) ctx.fillRect(wx, wy, 7, 9);
        }
      }
    }
    // Neon sign.
    if (b.neon) {
      ctx.save();
      ctx.shadowColor = b.neon;
      ctx.shadowBlur = 14;
      ctx.fillStyle = b.neon;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.name || 'KEYS', b.x + b.w / 2, b.y + b.h / 2 + 5);
      ctx.restore();
    }
  }

  // Trees and palms.
  for (const t of city.trees) {
    if (t.x < x0 - 20 || t.x > x1 + 20 || t.y < y0 - 20 || t.y > y1 + 20) continue;
    ctx.fillStyle = t.palm ? '#2f7a3d' : '#2c5a2e';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(t.x - 3, t.y - 3, t.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Street lamps.
  for (const l of city.lamps) {
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
    if (night > 0.4) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,220,140,0.9)';
      ctx.shadowColor = '#ffdc8c';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(l.x, l.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Shops.
  for (const s of city.shops) {
    if (s.x < x0 - 100 || s.x > x1 + 100 || s.y < y0 - 100 || s.y > y1 + 100) continue;
    ctx.save();
    ctx.fillStyle = '#20202c';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = s.color;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, s.x, s.y + 52);
    ctx.restore();
  }

  // Safehouse + hospital markers.
  ctx.save();
  ctx.fillStyle = '#00ffa3';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SAFEHOUSE', city.safehouse.x, city.safehouse.y - 46);
  ctx.strokeStyle = '#00ffa3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(city.safehouse.x, city.safehouse.y, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ff5e7a';
  ctx.fillText('HOSPITAL', city.hospital.x, city.hospital.y - 46);
  ctx.strokeStyle = '#ff5e7a';
  ctx.beginPath();
  ctx.arc(city.hospital.x, city.hospital.y, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
