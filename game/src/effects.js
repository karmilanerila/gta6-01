// Effects: smoke puffs, sparks, skid marks, bullet tracers and the muzzle
// flash light. One pool per effect type, all created up front so the frame
// never allocates. The world drives these; nothing here knows about gameplay.
import * as THREE from '../vendor/three.module.min.js';

const PUFF_COUNT = 26;
const SPARK_COUNT = 60;
const SKID_QUADS = 240;
const TRACER_COUNT = 6;

export function createEffects(scene) {
  const fx = {
    puffs: [],
    sparkData: [],
    skidQuads: [],
    tracers: [],
  };

  // ---- smoke puffs (camera-facing sprites) ----
  for (let i = 0; i < PUFF_COUNT; i += 1) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xbbbbbb, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    fx.puffs.push({ mesh: m, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 });
  }

  // ---- sparks (single Points cloud) ----
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffd27a, size: 0.5, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  fx.sparks = sparks;
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    fx.sparkData.push({ life: 0, vel: new THREE.Vector3() });
  }

  // ---- skid marks (one big quad strip, oldest quads recycled) ----
  const skidGeo = new THREE.BufferGeometry();
  skidGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKID_QUADS * 4 * 3), 3));
  skidGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(SKID_QUADS * 4 * 2), 2));
  const skidIdx = [];
  for (let i = 0; i < SKID_QUADS; i += 1) {
    const b = i * 4;
    skidIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  skidGeo.setIndex(skidIdx);
  const skid = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({
    color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  skid.frustumCulled = false;
  skid.position.y = 0.03;
  skid.renderOrder = 1;
  scene.add(skid);
  fx.skid = skid;

  // ---- bullet tracers (line pool) ----
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    fx.tracers.push({ line, life: 0 });
  }

  // ---- muzzle / explosion flash light ----
  const flash = new THREE.PointLight(0xffc37a, 0, 18, 1.8);
  scene.add(flash);
  fx.flash = flash;

  fx.spawnPuff = (x, y, z, vx, vy, vz, size, color, life) => {
    for (const p of fx.puffs) {
      if (p.life > 0) continue;
      p.life = life;
      p.max = life;
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      p.mesh.material.color.setHex(color);
      p.mesh.scale.setScalar(size);
      p.vel.set(vx, vy, vz);
      p.grow = size * 1.6;
      return;
    }
  };

  fx.spawnSparks = (x, y, z, n) => {
    let c = 0;
    for (let i = 0; i < fx.sparkData.length && c < n; i += 1) {
      const s = fx.sparkData[i];
      if (s.life > 0) continue;
      s.life = 0.5 + Math.random() * 0.4;
      s.vel.set((Math.random() - 0.5) * 14, Math.random() * 9 + 2, (Math.random() - 0.5) * 14);
      const pos = fx.sparks.geometry.attributes.position;
      pos.setXYZ(i, x, y, z);
      c += 1;
    }
  };

  fx.addSkid = (x1, z1, x2, z2) => {
    fx.skidQuads.push({ x1, z1, x2, z2 });
    if (fx.skidQuads.length > SKID_QUADS) fx.skidQuads.shift();
    const pos = fx.skid.geometry.attributes.position;
    const quads = fx.skidQuads;
    for (let i = 0; i < SKID_QUADS; i += 1) {
      const q = quads[i];
      const o = i * 12;
      if (!q) {
        for (let k = 0; k < 12; k += 1) pos.array[o + k] = 0;
        continue;
      }
      const dx = q.x2 - q.x1;
      const dz = q.z2 - q.z1;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * 0.22;
      const pz = (dx / len) * 0.22;
      pos.array[o] = q.x1 - px; pos.array[o + 1] = 0; pos.array[o + 2] = q.z1 - pz;
      pos.array[o + 3] = q.x1 + px; pos.array[o + 4] = 0; pos.array[o + 5] = q.z1 + pz;
      pos.array[o + 6] = q.x2 + px; pos.array[o + 7] = 0; pos.array[o + 8] = q.z2 + pz;
      pos.array[o + 9] = q.x2 - px; pos.array[o + 10] = 0; pos.array[o + 11] = q.z2 - pz;
    }
    pos.needsUpdate = true;
  };

  fx.fireTracer = (from, to, life = 0.07) => {
    const tr = fx.tracers.find((t) => t.life <= 0) ?? fx.tracers[0];
    const pos = tr.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tr.line.material.opacity = 0.9;
    tr.life = life;
  };

  fx.burst = (x, y, z, flashColor, flashIntensity) => {
    for (let i = 0; i < 8; i += 1) {
      fx.spawnPuff(
        x + (Math.random() - 0.5) * 3, y + Math.random() * 2, z + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4,
        2 + Math.random() * 3, i % 2 ? 0xff7a1a : 0x666666, 0.9 + Math.random() * 0.5,
      );
    }
    fx.spawnSparks(x, y + 1, z, 24);
    fx.flash.position.set(x, y + 2, z);
    fx.flash.color.setHex(flashColor);
    fx.flash.intensity = flashIntensity;
  };

  fx.update = (dt) => {
    for (const p of fx.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      // Sea breeze: smoke drifts gently toward the water (-x) as it rises.
      p.mesh.position.x -= 0.6 * dt;
      p.vel.y += 1.5 * dt;
      const k = p.life / p.max;
      p.mesh.material.opacity = 0.5 * k;
      p.mesh.scale.setScalar(p.grow * (1.6 - k * 0.6));
    }
    const pos = fx.sparks.geometry.attributes.position;
    for (let i = 0; i < fx.sparkData.length; i += 1) {
      const s = fx.sparkData[i];
      if (s.life <= 0) {
        pos.setXYZ(i, 0, -100, 0);
        continue;
      }
      s.life -= dt;
      s.vel.y -= 14 * dt;
      pos.setXYZ(i, pos.getX(i) + s.vel.x * dt, pos.getY(i) + s.vel.y * dt, pos.getZ(i) + s.vel.z * dt);
    }
    pos.needsUpdate = true;
    for (const t of fx.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.material.opacity = 0;
    }
    if (fx.flash.intensity > 0) {
      fx.flash.intensity = Math.max(0, fx.flash.intensity - dt * 900);
    }
  };

  return fx;
}
