// Shared helpers for Neon Bay Heat: seeded randomness, math, formatting and
// a tiny offscreen-canvas factory. No dependencies, no network. Everything
// here is written for this rebuild.

export const TAU = Math.PI * 2;

// Clamp a number into [lo, hi].
export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Linear blend between a and b.
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent exponential approach toward b.
export function damp(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

// Wrap an angle into (-PI, PI].
export function wrapAngle(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}

// Shortest-path angle interpolation (a moves toward b by fraction t).
export function angleLerp(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

// Signed smallest difference from a to b.
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

// Deterministic PRNG (sfc32). One stream per system keeps screenshots stable.
export function sfc32(seed) {
  let a = seed >>> 0;
  let b = (seed ^ 0x9e3779b9) >>> 0;
  let c = (seed ^ 0x85ebca6b) >>> 0;
  let counter = 1;
  return function () {
    const t = (a + b + counter) | 0;
    counter = (counter + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return ((t >>> 0) / 4294967296);
  };
}

export function makeRng(seed) {
  const next = sfc32(seed);
  return {
    next,
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    int(lo, hi) {
      return Math.floor(lo + next() * (hi - lo + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}

// Draw into an offscreen canvas and hand it back (callers wrap it in a texture).
export function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  return c;
}

// Hash a pair of grid coordinates into a stable 0..1 value (per-block variety).
export function hash2(x, z) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
}

// Squared distance in the XZ plane (avoids a sqrt when only comparing).
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// Ease-out curve for camera and UI motion.
export function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

export function fmtCash(n) {
  const s = String(Math.floor(n));
  let out = '';
  let i = s.length;
  while (i > 3) {
    out = ',' + s.slice(i - 3, i) + out;
    i -= 3;
  }
  return '$' + s.slice(0, i) + out;
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Time of day (0..1) as a 24-hour clock string, e.g. 0.72 -> "17:16".
export function fmtClock(tod) {
  const hours = Math.floor(tod * 24);
  const mins = Math.floor((tod * 24 - hours) * 60);
  return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
}
