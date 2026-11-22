// Procedural Web Audio for Neon Bay Heat: no audio files, everything is
// synthesized. Three radio stations run on a lookahead step sequencer, plus
// engine hum, tire screech, sirens, gunshots and UI blips. All nodes are
// created lazily on the first user gesture (PLAY click).
import { clamp } from './util.js';

// Each station: name, tempo, chord roots (one per bar, MIDI), and its lead /
// bass patterns as semitone offsets (null = rest).
const STATIONS = [
  {
    name: 'WAVE 98 · SYNTHWAVE', bpm: 104,
    roots: [45, 45, 43, 41],
    lead: [0, 3, 7, 10, 12, 10, 7, 3],
    bass: [0, 0, 7, 5],
  },
  {
    name: 'BASSLINE FM · HIP-HOP', bpm: 92,
    roots: [43, 43, 41, 40],
    lead: [0, null, 0, 3, null, 5, 3, 0],
    bass: [0, 0, 0, 10],
  },
  {
    name: 'CALIENTE · LATIN', bpm: 112,
    roots: [45, 48, 43, 41],
    lead: [0, 3, 7, 12, 10, 7, 5, 3],
    bass: [0, 5, 7, 10],
  },
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let station = 0;
  let playing = false;
  let muted = false;
  let step = 0;
  let nextStepTime = 0;
  let timer = null;

  // Engine: sawtooth + lowpass, pitch follows speed.
  let engineOsc = null;
  let engineOsc2 = null;
  let engineFilter = null;
  let engineGain = null;
  // Siren: triangle LFO between two tones.
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;
  // Screech: looped noise through a bandpass.
  let screechSrc = null;
  let screechGain = null;
  let screechFilter = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.34;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(master);
    } catch {
      return false;
    }
    return true;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function noteFreq(root, semitone) {
    return midiToFreq(root + semitone);
  }

  function blip(freq, dur, type, vol, when, dest) {
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest ?? musicGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function kick(when, vol) {
    const t = when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(musicGain);
    o.start(t);
    o.stop(t + 0.25);
  }

  function hat(when, vol, open) {
    const t = when;
    const len = open ? 0.18 : 0.05;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(musicGain);
    src.start(t);
  }

  // One 16th-note step of the current station's pattern.
  function scheduleStep(s, t) {
    const st = STATIONS[station];
    const bar = Math.floor(s / 16) % st.roots.length;
    const root = st.roots[bar];
    const beat = s % 16;
    const leadNote = st.lead[s % st.lead.length];
    const bassNote = st.bass[Math.floor(s / 4) % st.bass.length];
    if (station === 0) {
      // Synthwave: four-on-the-floor kick, hats, arpeggio, bass.
      if (beat % 4 === 0) kick(t, 0.9);
      if (beat % 4 === 2) hat(t, 0.16, false);
      if (beat % 2 === 0) hat(t, 0.08, false);
      blip(noteFreq(root + 24, leadNote), 0.22, 'sawtooth', 0.1, t);
      if (beat % 4 === 0) blip(noteFreq(root, bassNote), 0.5, 'square', 0.16, t);
      if (beat === 0) blip(noteFreq(root + 12, 0), 1.6, 'triangle', 0.05, t);
    } else if (station === 1) {
      // Hip-hop: boom-bap kick/snare-ish, sparse riff.
      if (beat === 0 || beat === 7 || beat === 10) kick(t, 0.95);
      if (beat === 4 || beat === 12) hat(t, 0.5, true);
      if (beat % 2 === 1) hat(t, 0.07, false);
      if (leadNote !== null && leadNote !== undefined) {
        blip(noteFreq(root + 24, leadNote), 0.3, 'square', 0.07, t);
      }
      if (beat % 4 === 0) blip(noteFreq(root - 12, bassNote), 0.55, 'sine', 0.3, t);
    } else {
      // Latin: clave + montuno + tumbao bass.
      if (beat === 0 || beat === 3 || beat === 6 || beat === 10 || beat === 12) {
        blip(1900, 0.05, 'square', 0.12, t);
      }
      if (beat % 4 === 0) kick(t, 0.55);
      if (beat % 2 === 0) hat(t, 0.1, false);
      blip(noteFreq(root + 24, leadNote), 0.18, 'triangle', 0.14, t);
      if (beat === 0 || beat === 6 || beat === 11) blip(noteFreq(root, bassNote), 0.4, 'sine', 0.26, t);
    }
  }

  function tick() {
    if (!ctx || !playing) return;
    const spb = 60 / STATIONS[station].bpm / 4; // 16th notes
    while (nextStepTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextStepTime);
      step = (step + 1) % 64;
      nextStepTime += spb;
    }
  }

  function startEngine() {
    if (!ctx || engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 28;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineFilter.Q.value = 2;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(sfxGain);
    engineOsc.start();
    engineOsc2.start();
  }

  function startSiren() {
    if (!ctx || sirenOsc) return;
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 750;
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'square';
    sirenLfo.frequency.value = 1.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(sfxGain);
    sirenOsc.start();
    sirenLfo.start();
  }

  function startScreech() {
    if (!ctx || screechSrc) return;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    screechSrc = ctx.createBufferSource();
    screechSrc.buffer = buf;
    screechSrc.loop = true;
    screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 950;
    screechFilter.Q.value = 6;
    screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechSrc.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(sfxGain);
    screechSrc.start();
  }

  // One-shot noise burst through a lowpass (shots, crashes, explosions).
  function noiseBurst(dur, cutoff, vol, tail) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, tail);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start(t);
    return t;
  }

  return {
    get stationName() {
      return STATIONS[station].name;
    },
    get stationIndex() {
      return station;
    },
    get isMuted() {
      return muted;
    },
    unlock() {
      if (!ensure()) return false;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      startEngine();
      startSiren();
      startScreech();
      if (!playing) {
        playing = true;
        step = 0;
        nextStepTime = ctx.currentTime + 0.06;
        if (!timer) timer = setInterval(tick, 40);
      }
      return true;
    },
    nextStation() {
      station = (station + 1) % STATIONS.length;
      step = 0;
      if (ctx) nextStepTime = ctx.currentTime + 0.05;
      return STATIONS[station].name;
    },
    // Jump straight to a station (used when restoring a save's radio).
    setStation(i) {
      station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
      step = 0;
      if (ctx) nextStepTime = ctx.currentTime + 0.05;
      return STATIONS[station].name;
    },
    setMuted(m) {
      muted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
    },
    // speed01: 0..1, drifting: bool, inCar: bool
    engine(speed01, drifting, inCar) {
      if (!ctx || !engineGain) return;
      const t = ctx.currentTime;
      const target = inCar ? 0.05 + speed01 * 0.075 : 0.0;
      engineGain.gain.setTargetAtTime(target, t, 0.08);
      const f = 52 + speed01 * 165 + (drifting ? 30 : 0);
      engineOsc.frequency.setTargetAtTime(f, t, 0.06);
      engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      engineFilter.frequency.setTargetAtTime(380 + speed01 * 1400, t, 0.1);
    },
    siren(on) {
      if (!ctx || !sirenGain) return;
      sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.3);
    },
    screech(on) {
      if (!ctx || !screechGain) return;
      screechGain.gain.setTargetAtTime(on ? 0.11 : 0, ctx.currentTime, 0.05);
    },
    shot() {
      if (!ctx) return;
      const t = noiseBurst(0.14, 2400, 0.8, 2.2);
      blip(90, 0.12, 'sine', 0.5, t, sfxGain);
    },
    crash(strength) {
      if (!ctx) return;
      const t = noiseBurst(0.3, 500 + strength * 900, clamp(0.25 + strength * 0.6, 0, 0.9), 1.6);
      blip(70, 0.2, 'sine', 0.5, t, sfxGain);
    },
    blip() {
      if (!ctx) return;
      blip(880, 0.09, 'sine', 0.25, ctx.currentTime, sfxGain);
    },
    cash() {
      if (!ctx) return;
      const t = ctx.currentTime;
      blip(1320, 0.1, 'sine', 0.3, t, sfxGain);
      blip(1760, 0.16, 'sine', 0.3, t + 0.09, sfxGain);
    },
    missionDone() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.22, 'triangle', 0.28, t + i * 0.11, sfxGain));
    },
    explosion() {
      if (!ctx) return;
      const t = noiseBurst(0.7, 320, 0.9, 1.2);
      blip(48, 0.6, 'sine', 0.7, t, sfxGain);
    },
    update() {
      tick();
    },
  };
}
