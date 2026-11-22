// Neon Bay: procedural open-world city. All textures are painted on canvas at
// boot; all meshes are original low-poly geometry. No external assets.
// Layout: beach + ocean east, art-deco hotel row on Palma Drive, downtown
// towers north-west, port basin south-west, park mid-city.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, hash2, makeCanvas, makeRng } from './util.js';

export const WORLD = {
  minX: -260, maxX: 260, minZ: -260, maxZ: 260,
  palmaX: 170, beachX: 177, waterX: 200,
  avenues: [-200, -120, -40, 40, 120],
  streets: [-200, -120, -40, 40, 120, 200],
  roadW: 14,
};

// ---------- procedural textures ----------

function facadeTexture(rng, base, opts = {}) {
  const floors = opts.floors ?? 8;
  const cols = opts.cols ?? 6;
  const deco = opts.deco ?? false;
  const litRatio = opts.litRatio ?? 0.45;
  const w = 128;
  const h = 256;
  const c = makeCanvas(w, h, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    if (deco) {
      // Art-deco vertical stripes + pastel banding.
      g.fillStyle = 'rgba(255,255,255,0.16)';
      for (let x = 8; x < w; x += 24) g.fillRect(x, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(0, 0, w, 10);
      g.fillRect(0, h - 12, w, 12);
    }
    const ww = (w - 16) / cols;
    const wh = (h - 20) / floors;
    for (let f = 0; f < floors; f += 1) {
      for (let col = 0; col < cols; col += 1) {
        const lit = rng.next() < litRatio;
        const x = 8 + col * ww + ww * 0.18;
        const y = 10 + f * wh + wh * 0.2;
        g.fillStyle = lit ? (rng.next() < 0.6 ? '#ffd27a' : '#9fe8ff') : '#20242e';
        g.fillRect(x, y, ww * 0.64, wh * 0.55);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x, y, ww * 0.64, 2);
      }
    }
    // Grime at the base.
    const grad = g.createLinearGradient(0, h - 40, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grad;
    g.fillRect(0, h - 40, w, 40);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function neonTexture(text, color, sub) {
  const c = makeCanvas(512, 160, (g) => {
    g.clearRect(0, 0, 512, 160);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.font = 'bold 64px Arial, sans-serif';
    g.fillText(text, 256, sub ? 62 : 80);
    g.shadowBlur = 10;
    g.fillStyle = '#ffffff';
    g.fillText(text, 256, sub ? 62 : 80);
    if (sub) {
      g.shadowColor = '#ff9de2';
      g.shadowBlur = 14;
      g.fillStyle = '#ff9de2';
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText(sub, 256, 122);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture() {
  const S = 2048;
  const scale = S / 520; // world 520 wide -> px
  const X = (x) => (x + 260) * scale;
  const Z = (z) => (z + 260) * scale;
  const c = makeCanvas(S, S, (g) => {
    // Base: block concrete (dusty purple-grey).
    g.fillStyle = '#3a3a48';
    g.fillRect(0, 0, S, S);
    // Park block grass.
    g.fillStyle = '#2e5d3a';
    g.fillRect(X(40), Z(40), 80 * scale, 80 * scale);
    // Port apron concrete.
    g.fillStyle = '#4a4a55';
    g.fillRect(X(-216), Z(140), 20 * scale, 120 * scale);
    // Sand beach.
    g.fillStyle = '#d9b380';
    g.fillRect(X(177), Z(-260), 23 * scale, 520 * scale);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 260; i += 1) {
      const px = X(179 + ((i * 37) % 18));
      const pz = Z(-255 + ((i * 91) % 510));
      g.fillRect(px, pz, 3, 3);
    }
    // Ocean floor (seen through transparent water plane).
    g.fillStyle = '#0b3d5c';
    g.fillRect(X(200), Z(-260), 60 * scale, 520 * scale);
    // Port basin floor.
    g.fillRect(X(-260), Z(150), 44 * scale, 110 * scale);
    // Roads: dark asphalt strips (avenues + streets + Palma Drive).
    g.fillStyle = '#2e2e38';
    for (const ax of WORLD.avenues) g.fillRect(X(ax - 7), Z(-260), 14 * scale, 520 * scale);
    for (const sz of WORLD.streets) g.fillRect(X(-260), Z(sz - 7), 520 * scale, 14 * scale);
    g.fillRect(X(163), Z(-260), 14 * scale, 520 * scale);
    // Sidewalk borders.
    g.strokeStyle = '#4a4a58';
    g.lineWidth = 5;
    for (const ax of [...WORLD.avenues, WORLD.palmaX]) {
      g.strokeRect(X(ax - 11), Z(-260), 22 * scale, 520 * scale);
    }
    for (const sz of WORLD.streets) {
      g.strokeRect(X(-260), Z(sz - 11), 520 * scale, 22 * scale);
    }
    // Lane dashes.
    g.fillStyle = '#c8b25a';
    for (const ax of [...WORLD.avenues, WORLD.palmaX]) {
      for (let z = -250; z < 250; z += 16) g.fillRect(X(ax - 0.4), Z(z), 1.6, 8 * scale * 0.5);
    }
    for (const sz of WORLD.streets) {
      for (let x = -250; x < 250; x += 16) g.fillRect(X(x), Z(sz - 0.4), 8 * scale * 0.5, 1.6);
    }
    // Crosswalks at every avenue/street crossing.
    g.fillStyle = 'rgba(230,230,230,0.75)';
    for (const ax of [...WORLD.avenues, WORLD.palmaX]) {
      for (const sz of WORLD.streets) {
        for (let i = -3; i <= 3; i += 1) {
          g.fillRect(X(ax + i * 1.8 - 0.7), Z(sz - 9), 1.4, 4);
          g.fillRect(X(ax + i * 1.8 - 0.7), Z(sz + 5), 1.4, 4);
        }
      }
    }
    // Beach umbrellas.
    const umbrella = ['#ff5da2', '#37e0c8', '#ffd166', '#ff7a3d'];
    for (let i = 0; i < 26; i += 1) {
      const ux = X(181 + ((i * 53) % 14));
      const uz = Z(-245 + ((i * 97) % 490));
      g.fillStyle = umbrella[i % 4];
      g.beginPath();
      g.arc(ux, uz, 7, 0, Math.PI * 2);
      g.fill();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function waterTexture() {
  const c = makeCanvas(256, 256, (g) => {
    g.fillStyle = '#1a6a8d';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i < 40; i += 1) {
      const x = (i * 67) % 256;
      const y = (i * 131) % 256;
      g.beginPath();
      g.arc(x, y, 6 + (i % 5) * 4, 0, Math.PI * 1.4);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 60; i += 1) g.fillRect((i * 41) % 256, (i * 89) % 256, 3, 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 18);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- city build ----------

const HOTEL_COLORS = ['#f7a8c4', '#8fd8c9', '#ffd9a0', '#f2e6c9', '#a8c8f0', '#f0a8a8'];
const TOWER_COLORS = ['#5a6b8a', '#6b7a94', '#4a5568', '#7a6a8a', '#3f4a5e'];
const MID_COLORS = ['#8a7a6a', '#a08a7a', '#7a8a94', '#9a8a5a', '#6a7a6a'];
const NEON_SIGNS = [
  ['HOTEL', 'PALMA', '#ff5da2'],
  ['NEON', 'BAY', '#37e0c8'],
  ['CASINO', 'SOLMAR', '#ffd166'],
  ['PIER 9', 'BAR', '#ff7a3d'],
  ['TACOS', '24 HRS', '#9dff57'],
  ['HOTEL', 'CORAL', '#ff9de2'],
  ['CLUB', 'AZURE', '#5aa2ff'],
  ['MOTEL', 'VACANCY', '#ff5d5d'],
];

export function buildCity(scene, seed) {
  const rng = makeRng(seed);
  const city = {
    colliders: [],
    waterRects: [
      { x0: 200, z0: -260, x1: 320, z1: 260 },
      { x0: -260, z0: 150, x1: -216, z1: 260 },
    ],
    props: [],
    carSpawns: [],
    playerSpawn: { x: 170, z: 20, heading: 0 },
    boatSpawn: { x: 203, z: 60, heading: Math.PI / 2 },
    basinBoatSpawn: { x: -219, z: 200, heading: Math.PI / 2 },
    hospital: { x: -80, z: 80 },
    policeStation: { x: 80, z: -80 },
    raceStart: { x: 170, z: -180 },
    heistSpot: { x: -160, z: 180 },
    boatDock: { x: -210, z: 155 },
    update: null,
    isWater: null,
    collideCircle: null,
  };

  // ----- lights, sky, fog -----
  const hemi = new THREE.HemisphereLight(0x8fb7ff, 0x2a1a2a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb37a, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const moon = new THREE.DirectionalLight(0x8fb0ff, 0.25);
  moon.position.set(-80, 140, -60);
  scene.add(moon);
  scene.fog = new THREE.FogExp2(0x2a1e33, 0.0016);

  const sunSprite = new THREE.Mesh(
    new THREE.CircleGeometry(18, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: 0.95 }),
  );
  const moonSprite = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe9ff, fog: false, transparent: true, opacity: 0.9 }),
  );
  scene.add(sunSprite);
  scene.add(moonSprite);

  // ----- ground -----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ----- water -----
  const waterTex = waterTexture();
  const waterMat = new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.78, color: 0xbfe0f0,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(120, 520), waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(260, 0.4, 0);
  ocean.receiveShadow = true;
  scene.add(ocean);
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(44, 110), waterMat.clone());
  basin.material.map = waterTex;
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(-238, 0.4, 205);
  scene.add(basin);

  // ----- buildings -----
  const facadeMats = new Map();
  function facadeMat(key, make) {
    if (!facadeMats.has(key)) facadeMats.set(key, new THREE.MeshLambertMaterial({ map: make() }));
    return facadeMats.get(key);
  }
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2b2b33 });
  const roofMat2 = new THREE.MeshLambertMaterial({ color: 0x3d3a35 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const signMats = [];
  const signMeshes = [];

  function addBuilding(cx, cz, w, d, h, opts = {}) {
    const mat = facadeMat(opts.matKey, () => facadeTexture(
      makeRng((cx * 31 + cz * 17 + h) | 0),
      opts.color,
      { floors: clamp(Math.round(h / 6), 2, 22), cols: clamp(Math.round(w / 5), 3, 8), deco: !!opts.deco, litRatio: opts.litRatio ?? 0.45 },
    ));
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w, h, d);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const roof = new THREE.Mesh(boxGeo, rng.next() < 0.5 ? roofMat : roofMat2);
    roof.scale.set(w + 0.6, 0.8, d + 0.6);
    roof.position.set(cx, h + 0.4, cz);
    roof.castShadow = true;
    scene.add(roof);
    if (h > 14 && rng.next() < 0.7) {
      const ac = new THREE.Mesh(boxGeo, roofMat);
      ac.scale.set(3, 1.6, 2.4);
      ac.position.set(cx + rng.range(-w / 4, w / 4), h + 1.6, cz + rng.range(-d / 4, d / 4));
      scene.add(ac);
    }
    if (h > 40 && rng.next() < 0.6) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 9, 5), roofMat);
      ant.position.set(cx, h + 5, cz);
      scene.add(ant);
    }
    city.colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });
    if (opts.sign) {
      const [text, sub, color] = opts.sign;
      const sm = new THREE.MeshBasicMaterial({
        map: neonTexture(text, color, sub), transparent: true, side: THREE.DoubleSide,
      });
      const sw = Math.min(w * 0.9, 22);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.3125), sm);
      if (opts.signFace === 'x') {
        s.rotation.y = Math.PI / 2;
        s.position.set(cx + w / 2 + 0.4, h + 3.4, cz);
      } else {
        s.position.set(cx, h + 3.4, cz + d / 2 + 0.4);
      }
      scene.add(s);
      signMats.push(sm);
      signMeshes.push(s);
    }
    return m;
  }

  // City blocks: between avenues/streets.
  const ave = WORLD.avenues;
  const st = WORLD.streets;
  function blockRange(list) {
    const out = [];
    for (let i = 0; i < list.length - 1; i += 1) out.push([list[i] + 11, list[i + 1] - 11]);
    return out;
  }
  const xBlocks = [[-260 + 11, ave[0] - 11], ...blockRange(ave), [ave[ave.length - 1] + 11, WORLD.palmaX - 11]];
  const zBlocks = [[-260 + 11, st[0] - 11], ...blockRange(st), [st[st.length - 1] + 11, 260 - 11]];

  let signIdx = 0;
  for (const [x0, x1] of xBlocks) {
    for (const [z0, z1] of zBlocks) {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const bw = x1 - x0;
      const bd = z1 - z0;
      if (Math.abs(cx - 80) < 1 && Math.abs(cz - 80) < 1) continue; // park
      if (Math.abs(cx + 80) < 1 && Math.abs(cz - 80) < 1) continue; // hospital block
      if (Math.abs(cx - 80) < 1 && Math.abs(cz + 80) < 1) continue; // police block
      if (x0 < -195 && z0 >= 130) continue; // port basin / apron
      const downtown = cx < -20 && cz < -20;
      const beachfront = x0 >= 120;
      const h = hash2(Math.round(cx), Math.round(cz));
      if (beachfront) {
        const hotelH = 14 + h * 22;
        const ci = Math.floor(h * HOTEL_COLORS.length) % HOTEL_COLORS.length;
        addBuilding(cx, cz, bw - 4, bd - 4, hotelH, {
          color: HOTEL_COLORS[ci],
          deco: true,
          matKey: 'hotel-' + ci,
          sign: (signIdx < NEON_SIGNS.length && Math.floor(h * 10) % 3 === 0) ? NEON_SIGNS[signIdx++] : null,
          signFace: 'x',
          litRatio: 0.6,
        });
      } else if (downtown) {
        const n = h < 0.5 ? 1 : 2;
        for (let i = 0; i < n; i += 1) {
          const w = (bw - 6) / n;
          const bx = x0 + 3 + w * (i + 0.5);
          const bh = 55 + h * 75 + i * 13;
          const ci = Math.floor(h * TOWER_COLORS.length) % TOWER_COLORS.length;
          addBuilding(bx, cz, w - 3, bd - 6, bh, {
            color: TOWER_COLORS[ci],
            matKey: 'tower-' + ci + '-' + i,
            litRatio: 0.5,
          });
        }
      } else {
        const nx = bw > 50 ? 2 : 1;
        const nz = bd > 50 ? 2 : 1;
        for (let ix = 0; ix < nx; ix += 1) {
          for (let iz = 0; iz < nz; iz += 1) {
            const w = (bw - 4) / nx;
            const d = (bd - 4) / nz;
            const bx = x0 + 2 + w * (ix + 0.5);
            const bz = z0 + 2 + d * (iz + 0.5);
            const bh = 10 + hash2(Math.round(bx), Math.round(bz)) * 26;
            const ci = Math.floor(hash2(Math.round(bx), 7) * MID_COLORS.length) % MID_COLORS.length;
            addBuilding(bx, bz, w - 3, d - 3, bh, {
              color: MID_COLORS[ci],
              matKey: 'mid-' + ci,
              sign: (ix === 0 && iz === 0 && signIdx < NEON_SIGNS.length && hash2(Math.round(bx), 3) < 0.4)
                ? NEON_SIGNS[signIdx++] : null,
              litRatio: 0.5,
            });
          }
        }
      }
    }
  }

  // Hospital + police station (distinct, in their reserved blocks).
  addBuilding(city.hospital.x, city.hospital.z, 26, 18, 12, { color: '#e8e8e8', matKey: 'hospital', litRatio: 0.8 });
  addBuilding(city.policeStation.x, city.policeStation.z, 24, 18, 14, { color: '#3a5a8a', matKey: 'police-hq', litRatio: 0.6 });

  // Port: containers + cranes on the apron (x -216..-196, z 140..260).
  const contCols = ['#c8553d', '#3d7ac8', '#c8a13d', '#4a9a5a', '#8a5ac8'];
  const contSpots = [[-208, 165], [-208, 185], [-208, 205], [-208, 225], [-200, 175], [-200, 215], [-200, 245]];
  contSpots.forEach(([cx, cz], i) => {
    const cm = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: contCols[i % contCols.length] }));
    cm.scale.set(7, 2.6, 2.6);
    cm.position.set(cx, 1.3, cz);
    cm.castShadow = true;
    scene.add(cm);
    city.colliders.push({ x0: cx - 3.5, z0: cz - 1.3, x1: cx + 3.5, z1: cz + 1.3 });
  });
  for (const cz of [170, 215]) {
    const legMat = new THREE.MeshLambertMaterial({ color: 0xd8a13d });
    const leg = new THREE.Mesh(boxGeo, legMat);
    leg.scale.set(2, 22, 2);
    leg.position.set(-214, 11, cz);
    leg.castShadow = true;
    scene.add(leg);
    const arm = new THREE.Mesh(boxGeo, legMat);
    arm.scale.set(26, 1.6, 1.6);
    arm.position.set(-202, 21, cz);
    scene.add(arm);
    city.colliders.push({ x0: -215.5, z0: cz - 1.5, x1: -212.5, z1: cz + 1.5 });
  }

  // ----- palms (instanced) -----
  const palmSpots = [];
  for (let z = -240; z <= 240; z += 24) {
    palmSpots.push([159, z + 6]);
    palmSpots.push([181, z - 4]);
  }
  for (const ax of [-120, -40, 40, 120]) {
    for (let z = -200; z <= 200; z += 80) palmSpots.push([ax + 10, z]);
  }
  for (let i = 0; i < 14; i += 1) {
    palmSpots.push([52 + hash2(i, 1) * 56, 52 + hash2(i, 2) * 56]); // park
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 7, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crownGeo = new THREE.ConeGeometry(2.6, 3.2, 7);
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3a8a44 });
  // Four fronds per palm instead of one cone: the crown reads as a palm,
  // not a lollipop.
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length * 4);
  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  palmSpots.forEach(([px, pz], i) => {
    const lean = hash2(i, 5) * 0.14 - 0.07;
    dummy.position.set(px, 3.5, pz);
    dummy.rotation.set(lean, hash2(i, 6) * 6.28, lean * 0.7);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const baseAng = hash2(i, 6) * 6.28;
    for (let f = 0; f < 4; f += 1) {
      const a = baseAng + (f * Math.PI) / 2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.75, 0.66, Math.sin(a) * 0.75).normalize();
      dummy.position.set(px + dir.x * 1.2, 7 + dir.y * 1.2, pz + dir.z * 1.2);
      dummy.quaternion.setFromUnitVectors(upVec, dir);
      dummy.scale.set(0.6, 0.75, 0.6);
      dummy.updateMatrix();
      crowns.setMatrixAt(i * 4 + f, dummy.matrix);
    }
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  scene.add(trunks);
  scene.add(crowns);

  // ----- beach landmark: ferris wheel + lifeguard tower -----
  // A slow-turning wheel on the sand gives the beach a silhouette from
  // Palma Drive and from the water. Cabins stay upright (repositioned in
  // city.update); the rim and spokes spin.
  const wheel = { angle: 0, spin: null, cabins: [], x: 185, z: 150, hubY: 14, r: 9 };
  const wheelSpin = new THREE.Group();
  wheelSpin.position.set(wheel.x, wheel.hubY, wheel.z);
  wheelSpin.rotation.y = Math.PI / 2; // wheel plane faces the city / beach
  wheel.spin = wheelSpin;
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xff5da2 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wheel.r, 0.35, 8, 28), rimMat);
  wheelSpin.add(rim);
  const spokeMat = new THREE.MeshLambertMaterial({ color: 0xd8d8e8 });
  for (let k = 0; k < 4; k += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, wheel.r * 2, 0.25), spokeMat);
    spoke.rotation.z = (k * Math.PI) / 4;
    wheelSpin.add(spoke);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 2.2, 10),
    new THREE.MeshLambertMaterial({ color: 0xffd166 }),
  );
  hub.rotation.x = Math.PI / 2;
  wheelSpin.add(hub);
  scene.add(wheelSpin);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x8a8a9a });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 15.5, 0.6), legMat);
    leg.position.set(wheel.x, 7, wheel.z + side * 2.2);
    leg.rotation.x = side * 0.28;
    leg.castShadow = true;
    scene.add(leg);
  }
  const cabinColors = [0xff2e88, 0xffd166, 0x2eff7a, 0x3da8ff, 0xff7a2e, 0xc86bff, 0x2ee8ff, 0xff5d5d];
  for (let i = 0; i < 8; i += 1) {
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1.5, 1.5),
      new THREE.MeshLambertMaterial({ color: cabinColors[i % cabinColors.length] }),
    );
    cabin.castShadow = true;
    scene.add(cabin);
    wheel.cabins.push(cabin);
  }
  city.colliders.push({ x0: 183, z0: 148, x1: 187, z1: 152 }); // wheel legs
  // Lifeguard tower: platform on legs with a roof, south of the wheel.
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const towerRed = new THREE.MeshLambertMaterial({ color: 0xc22e2e });
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const tleg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), towerMat);
    tleg.position.set(190 + lx, 1.5, 120 + lz);
    scene.add(tleg);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 3.2), towerMat);
  platform.position.set(190, 3.1, 120);
  scene.add(platform);
  const chair = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.6), towerRed);
  chair.position.set(190, 3.9, 120 - 1.1);
  scene.add(chair);
  const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 3.6), towerRed);
  towerRoof.position.set(190, 5.6, 120);
  scene.add(towerRoof);
  city.colliders.push({ x0: 188.5, z0: 118.5, x1: 191.5, z1: 121.5 }); // tower legs

  // ----- streetlamps (instanced) + a few real night lights -----
  const lampSpots = [];
  for (const ax of [...WORLD.avenues, WORLD.palmaX]) {
    for (let z = -230; z <= 230; z += 46) lampSpots.push([ax + 9, z]);
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x30303a });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach(([px, pz], i) => {
    dummy.position.set(px, 3, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, 6.1, pz);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles);
  scene.add(heads);
  const lampLights = [];
  const lampLightSpots = [[170, -150], [170, -30], [170, 90], [170, 210], [-80, -80], [40, 40]];
  for (const [lx, lz] of lampLightSpots) {
    const pl = new THREE.PointLight(0xffc37a, 0, 55, 1.6);
    pl.position.set(lx, 7, lz);
    scene.add(pl);
    lampLights.push(pl);
  }

  // ----- destructible props: hydrants + barriers -----
  const hydrantGeo = new THREE.CylinderGeometry(0.32, 0.4, 1.1, 8);
  const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xc22e2e });
  const barrierGeo = new THREE.BoxGeometry(2.4, 0.9, 0.4);
  const barrierMat = new THREE.MeshLambertMaterial({ color: 0xe07b28 });
  function addProp(kind, x, z, rotY) {
    const mesh = new THREE.Mesh(kind === 'hydrant' ? hydrantGeo : barrierGeo, kind === 'hydrant' ? hydrantMat : barrierMat);
    mesh.position.set(x, kind === 'hydrant' ? 0.55 : 0.45, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    scene.add(mesh);
    const p = { kind, mesh, x, z, rotY, broken: false, vx: 0, vz: 0, spin: 0, timer: 0 };
    city.props.push(p);
    return p;
  }
  for (let i = 0; i < 16; i += 1) {
    const ax = WORLD.avenues[i % WORLD.avenues.length];
    const sz = WORLD.streets[Math.floor(i / WORLD.avenues.length) % WORLD.streets.length];
    addProp('hydrant', ax + 10, sz + 10, hash2(i, 9) * 3);
  }
  const barrierSpots = [[-196, 145], [-196, 175], [-196, 235], [120, -190], [40, 210], [-40, -210], [150, 100]];
  barrierSpots.forEach(([bx, bz], i) => addProp('barrier', bx, bz, i % 2 ? Math.PI / 2 : 0));

  // ----- parked car spawns -----
  const parkedDefs = ['muscle', 'supercar', 'taxi', 'muscle', 'supercar', 'taxi', 'muscle', 'supercar'];
  const parkedSpots = [
    [162, -60, 0], [162, 60, 0], [162, 150, Math.PI], [178, -120, Math.PI],
    [-111, -160, Math.PI / 2], [49, -60, 0], [129, 100, Math.PI], [-31, 150, Math.PI / 2],
  ];
  parkedSpots.forEach(([px, pz, h], i) => {
    city.carSpawns.push({ x: px, z: pz, heading: h, def: parkedDefs[i % parkedDefs.length], parked: true });
  });

  // ----- world edge colliders (keep everyone inside) -----
  city.colliders.push(
    { x0: -262, z0: -262, x1: 262, z1: -258 },
    { x0: -262, z0: 258, x1: 262, z1: 262 },
    { x0: -262, z0: -262, x1: -258, z1: 262 },
    { x0: 258, z0: -262, x1: 262, z1: 262 },
  );

  // ----- collision helpers -----
  city.isWater = (x, z) => city.waterRects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

  // Push a circle out of building AABBs. Returns true if it hit something.
  city.collideCircle = (pos, r) => {
    let hit = false;
    for (const c of city.colliders) {
      const nx = clamp(pos.x, c.x0, c.x1);
      const nz = clamp(pos.z, c.z0, c.z1);
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * r;
          pos.z = nz + (dz / d) * r;
        } else {
          // Inside the box: push out along the smallest penetration axis.
          const pl = pos.x - c.x0;
          const pr = c.x1 - pos.x;
          const pt = pos.z - c.z0;
          const pb = c.z1 - pos.z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) pos.x = c.x0 - r;
          else if (m === pr) pos.x = c.x1 + r;
          else if (m === pt) pos.z = c.z0 - r;
          else pos.z = c.z1 + r;
        }
      }
    }
    return hit;
  };

  // ----- day / night cycle -----
  const skyDay = new THREE.Color(0x7fb2d9);
  const skySunset = new THREE.Color(0xff7a5c);
  const skyNight = new THREE.Color(0x0a0e1e);
  const fogDay = new THREE.Color(0x9fc3dd);
  const fogSunset = new THREE.Color(0x5a2e4a);
  const fogNight = new THREE.Color(0x0a0e1e);
  const tmpColor = new THREE.Color();
  let flickerT = 0;

  city.update = (dt, tod, focus) => {
    // tod: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
    const ang = (tod - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const dayF = clamp(elev * 2.2, 0, 1); // 1 at noon, 0 at night
    const sunsetF = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (elev > -0.12 ? 1 : 0);
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.max(elev, 0.04), 0.35).normalize();
    sun.position.copy(focus).addScaledVector(sunDir, 260);
    sun.target.position.copy(focus);
    sun.intensity = 0.12 + dayF * 1.9 + sunsetF * 0.9;
    sun.color.setHex(sunsetF > 0.4 ? 0xff8a4d : 0xfff2d8);
    hemi.intensity = 0.3 + dayF * 0.5;
    moon.intensity = (1 - dayF) * 0.3;
    // Sky + fog.
    tmpColor.copy(skyNight).lerp(skyDay, dayF).lerp(skySunset, sunsetF * 0.75);
    scene.background = tmpColor;
    scene.fog.color.copy(fogNight).lerp(fogDay, dayF).lerp(fogSunset, sunsetF * 0.7);
    scene.fog.density = 0.0011 + (1 - dayF) * 0.0009;
    // Sun / moon billboards.
    sunSprite.position.copy(focus).addScaledVector(sunDir, 420);
    sunSprite.lookAt(focus);
    sunSprite.material.opacity = clamp(elev * 4 + 0.4, 0, 0.95);
    const moonDir = new THREE.Vector3(-Math.cos(ang), Math.max(-elev, 0.05), -0.3).normalize();
    moonSprite.position.copy(focus).addScaledVector(moonDir, 420);
    moonSprite.lookAt(focus);
    moonSprite.material.opacity = clamp(-elev * 4 + 0.2, 0, 0.9);
    // Lamps + neon.
    const nightF = 1 - dayF;
    for (const pl of lampLights) pl.intensity = nightF * 90;
    headMat.color.setHex(nightF > 0.4 ? 0xffe9a8 : 0x8a8578);
    flickerT += dt;
    signMats.forEach((sm, i) => {
      let o = 0.55 + nightF * 0.45;
      if (i === 2 && nightF > 0.5) o *= (Math.sin(flickerT * 13) > -0.86 ? 1 : 0.25); // one buzzing sign
      sm.opacity = o;
    });
    // Water drift.
    waterTex.offset.x += dt * 0.008;
    waterTex.offset.y += dt * 0.005;
    // Ferris wheel: slow spin, cabins stay upright on the rim.
    wheel.angle += dt * 0.12;
    wheel.spin.rotation.z = wheel.angle;
    wheel.cabins.forEach((c, i) => {
      const a = wheel.angle + (i * Math.PI) / 4;
      c.position.set(wheel.x, wheel.hubY + Math.sin(a) * wheel.r, wheel.z + Math.cos(a) * wheel.r);
    });
  };

  return { city, rng, scene, signMats, signMeshes, sun, hemi, moon, sunSprite, moonSprite, waterTex };
}
