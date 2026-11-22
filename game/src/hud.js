// GTA-style HUD: health/armor, cash, wanted stars, weapon, speed, radio,
// radar minimap, banners, toasts, title and wasted/busted overlays.
// Pure DOM + one 2D canvas; no assets.
import { fmtCash, fmtTime } from './util.js';

const MAP_RANGE = 520; // world units across the minimap

export function createHUD(hooks) {
  const root = document.getElementById('hud');
  const mk = (tag, cls, parent) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (parent) parent.appendChild(el);
    return el;
  };

  // Top-left: health + armor.
  const vitals = mk('div', 'vitals', root);
  const hpRow = mk('div', 'bar-row', vitals);
  mk('span', 'bar-label', hpRow).textContent = 'HP';
  const hpBar = mk('div', 'bar hp', hpRow);
  const hpFill = mk('div', 'fill', hpBar);
  const arRow = mk('div', 'bar-row', vitals);
  mk('span', 'bar-label', arRow).textContent = 'ARMOR';
  const arBar = mk('div', 'bar armor', arRow);
  const arFill = mk('div', 'fill', arBar);

  // Top-right: cash + wanted stars.
  const tr = mk('div', 'top-right', root);
  const cashEl = mk('div', 'cash', tr);
  cashEl.textContent = '$250';
  const starsEl = mk('div', 'stars', tr);
  const starSpans = [];
  for (let i = 0; i < 5; i += 1) {
    const s = mk('span', 'star', starsEl);
    s.textContent = '★';
    starSpans.push(s);
  }

  // Objective line (top-centre).
  const objectiveEl = mk('div', 'objective', root);
  objectiveEl.textContent = 'Welcome to Neon Bay — steal a car, make some cash.';

  // Banner (centre).
  const bannerEl = mk('div', 'banner hidden', root);
  const bannerTitle = mk('div', 'banner-title', bannerEl);
  const bannerSub = mk('div', 'banner-sub', bannerEl);

  // Toast (lower-centre).
  const toastEl = mk('div', 'toast hidden', root);

  // Bottom-left: radar.
  const mapWrap = mk('div', 'map-wrap', root);
  const mapCanvas = mk('canvas', 'minimap', mapWrap);
  mapCanvas.width = 190;
  mapCanvas.height = 190;
  const mapCtx = mapCanvas.getContext('2d');
  const clockEl = mk('div', 'clock', mapWrap);

  // Bottom-right: weapon + speed + radio.
  const br = mk('div', 'bottom-right', root);
  const weaponEl = mk('div', 'weapon', br);
  const speedEl = mk('div', 'speed hidden', br);
  const radioEl = mk('div', 'radio', br);

  // Crosshair.
  const cross = mk('div', 'crosshair hidden', root);
  mk('div', 'ch-dot', cross);

  // Damage vignette + low-health pulse.
  const dmgEl = mk('div', 'damage hidden', root);

  // Controls hint.
  const hintEl = mk('div', 'hint', root);
  hintEl.innerHTML = '<b>WASD</b> move / drive &nbsp; <b>E</b> enter car &nbsp; <b>Space</b> handbrake / jump &nbsp; <b>Shift</b> nitro / sprint &nbsp; <b>1-4</b> weapons &nbsp; <b>R</b> radio &nbsp; <b>M</b> mute &nbsp; <b>P</b> pause';

  // Title overlay.
  const titleEl = mk('div', 'title', root);
  titleEl.innerHTML = '<div class="title-kicker">WELCOME TO</div>'
    + '<div class="title-logo">NEON BAY<br><span>HEAT</span></div>'
    + '<div class="title-sub">An open-world crime story. Steal cars, dodge the law,<br>run five jobs for Lena and own the night.</div>';
  const playBtn = mk('button', 'play-btn', titleEl);
  playBtn.textContent = '▶  PLAY';
  const titleNote = mk('div', 'title-note', titleEl);
  titleNote.textContent = 'Best with sound on. Click PLAY and you are in the action.';
  // Story progress on the title screen (Lena's jobs), updated by main.js.
  const jobsEl = mk('div', 'title-note', titleEl);
  jobsEl.textContent = '';
  const saveNote = mk('div', 'title-save hidden', titleEl);

  // Wasted / busted overlay.
  const endEl = mk('div', 'end hidden', root);
  const endTitle = mk('div', 'end-title', endEl);
  const endSub = mk('div', 'end-sub', endEl);
  const endBtn = mk('button', 'play-btn', endEl);
  endBtn.textContent = 'CONTINUE';

  // Pause overlay.
  const pauseEl = mk('div', 'pause hidden', root);
  pauseEl.innerHTML = '<div class="pause-title">PAUSED</div><div class="pause-sub">Press P or Esc to resume</div>';

  let bannerTimer = null;
  let toastTimer = null;

  function drawMinimap(s) {
    const ctx = mapCtx;
    const W = 190;
    const H = 190;
    const sc = W / MAP_RANGE;
    const toX = (x) => (x + 260) * sc;
    const toY = (z) => (z + 260) * sc;
    ctx.clearRect(0, 0, W, H);
    // Base.
    ctx.fillStyle = '#14141f';
    ctx.fillRect(0, 0, W, H);
    // Ocean + beach.
    ctx.fillStyle = '#0e5a7d';
    ctx.fillRect(toX(200), 0, W - toX(200), H);
    ctx.fillStyle = '#d9b380';
    ctx.fillRect(toX(177), 0, toX(200) - toX(177), H);
    // Port basin.
    ctx.fillRect(toX(-260), toY(150), toX(-216) - toX(-260), toY(260) - toY(150));
    // Park.
    ctx.fillStyle = '#2e5d3a';
    ctx.fillRect(toX(40), toY(40), 80 * sc, 80 * sc);
    // Roads.
    ctx.fillStyle = '#55555f';
    for (const ax of [-200, -120, -40, 40, 120, 170]) ctx.fillRect(toX(ax - 7), 0, 14 * sc, H);
    for (const sz of [-200, -120, -40, 40, 120, 200]) ctx.fillRect(0, toY(sz - 7), W, 14 * sc);
    // Blips.
    const dot = (x, z, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (s.minimap) {
      for (const t of s.minimap.traffic ?? []) dot(t.x, t.z, '#dddddd', 2);
      for (const pd of s.minimap.peds ?? []) dot(pd.x, pd.z, '#888888', 1.5);
      for (const mk2 of s.minimap.markers ?? []) dot(mk2.x, mk2.z, mk2.color, 4);
      if (s.minimap.truck) dot(s.minimap.truck.x, s.minimap.truck.z, '#ffd166', 4);
      for (const c of s.minimap.police ?? []) dot(c.x, c.z, '#3d7aff', 3.5);
      if (s.minimap.heli) dot(s.minimap.heli.x, s.minimap.heli.z, '#3d7aff', 4);
      // Player arrow.
      const px = toX(s.minimap.player.x);
      const py = toY(s.minimap.player.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - s.minimap.player.heading);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // View cone (subtle).
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(px, py, 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Border.
    ctx.strokeStyle = '#ff5da2';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  return {
    setObjective(text) {
      objectiveEl.textContent = text;
    },
    banner(title, sub) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub ?? '';
      bannerEl.classList.remove('hidden');
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), 3600);
    },
    toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
    },
    damageFlash() {
      dmgEl.classList.remove('hidden');
      setTimeout(() => dmgEl.classList.add('hidden'), 220);
    },
    showTitle(hasSave, saveText) {
      titleEl.classList.remove('hidden');
      if (hasSave) {
        saveNote.classList.remove('hidden');
        saveNote.textContent = saveText;
      }
    },
    // Lena's job progress on the title screen ("Jobs done: 2/5").
    setJobsDone(done, total) {
      jobsEl.textContent = total > 0 ? 'Jobs done: ' + done + '/' + total + ' — Lena is watching.' : '';
    },
    hideTitle() {
      titleEl.classList.add('hidden');
    },
    showEnd(kind, sub) {
      endTitle.textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
      endSub.textContent = sub;
      endEl.classList.remove('hidden');
    },
    hideEnd() {
      endEl.classList.add('hidden');
    },
    showPause(show) {
      pauseEl.classList.toggle('hidden', !show);
    },
    onPlayClick(fn) {
      playBtn.addEventListener('click', fn);
    },
    onContinueClick(fn) {
      endBtn.addEventListener('click', fn);
    },
    update(s) {
      hpFill.style.width = Math.max(0, s.health) + '%';
      arFill.style.width = Math.max(0, s.armor) + '%';
      hpFill.classList.toggle('low', s.health < 30);
      cashEl.textContent = fmtCash(s.cash);
      starSpans.forEach((sp, i) => sp.classList.toggle('on', i < s.wanted));
      weaponEl.textContent = s.weaponName + (s.ammo === Infinity ? '' : '  ·  ' + s.ammo);
      if (s.driving) {
        speedEl.classList.remove('hidden');
        speedEl.innerHTML = Math.round(s.speedKmh) + '<span> mph</span><div class="veh-name">'
          + s.vehicleName + (s.nitro > 0 ? ' · NITRO ' + Math.round(s.nitro) + '%' : '') + '</div>';
      } else {
        speedEl.classList.add('hidden');
      }
      radioEl.textContent = '♪ ' + s.radio;
      clockEl.textContent = s.clock;
      // The objective line always shows the current objective (the staged
      // screenshots pass a scene-specific one); the mission timer is
      // appended only while a mission is running.
      objectiveEl.textContent = s.missionTime != null
        ? s.objective + '   ·   ' + fmtTime(Math.max(0, s.missionTime))
        : s.objective;
      cross.classList.toggle('hidden', !(s.onFoot && s.weaponIndex > 0));
      dmgEl.classList.toggle('lowhp', s.health > 0 && s.health < 30);
      drawMinimap(s);
    },
  };
}
