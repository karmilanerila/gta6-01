// Sunset Keys — procedural audio: engine hum, sirens, effects and two radio
// stations, all synthesized with Web Audio. No audio files. Written fresh for round 5.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.radioGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.station = 0;
    this.radioTimer = null;
    this.nextNote = 0;
    this.step = 0;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Engine: two detuned saws through a lowpass.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 60;
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 30;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();
      // Radio bus.
      this.radioGain = this.ctx.createGain();
      this.radioGain.gain.value = 0.16;
      this.radioGain.connect(this.master);
      // Siren.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.startRadio();
      return true;
    } catch (e) {
      return false;
    }
  }

  setEngine(speedNorm, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = on ? 0.05 + speedNorm * 0.09 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    const freq = 55 + speedNorm * 165;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(320 + speedNorm * 900, t, 0.1);
  }

  setSiren(on, wanted) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.2);
    if (on) {
      const phase = Math.floor(t * 1.6) % 2 === 0;
      this.sirenOsc.frequency.setTargetAtTime(phase ? 720 : 960, t, 0.05);
    }
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, freq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq || 900;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.25;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  crash(strength) {
    this.noise(0.25, Math.min(0.5, 0.1 + strength * 0.3), 700);
    this.blip(70, 0.2, 'sine', 0.3);
  }

  gunshot() {
    this.noise(0.12, 0.4, 2400);
    this.blip(180, 0.08, 'square', 0.2);
  }

  // A two-tone car horn (H key).
  horn() {
    if (!this.ctx) return;
    this.blip(370, 0.28, 'square', 0.12);
    this.blip(466, 0.28, 'square', 0.1);
  }

  jingle(kind) {
    if (!this.ctx) return;
    const seqs = {
      start: [523, 659, 784],
      checkpoint: [784, 988],
      win: [523, 659, 784, 1047, 1319],
      fail: [392, 330, 262],
    };
    const notes = seqs[kind] || seqs.start;
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.22, 'triangle', 0.22), i * 110);
    });
  }

  // ---- radio -------------------------------------------------------------
  // Two stations, each a 16-step sequencer. Station 0 is a synthwave drive
  // (minor arpeggio over a pulsing bass); station 1 is a breezy island skank
  // (offbeat chords over a laid-back bass line).

  stationName(i) {
    return i === 0 ? 'Sunset FM — synthwave' : 'Keys 101 — island breeze';
  }

  setStation(i) {
    this.station = i % 2;
    this.step = 0;
  }

  startRadio() {
    if (this.radioTimer) return;
    this.radioTimer = setInterval(() => this.radioTick(), 125);
  }

  radioTick() {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.05;
    const s = this.step % 16;
    if (this.station === 0) {
      // Am – F – C – G, one chord per bar of 4 steps... here one chord per 4 steps.
      const chords = [
        [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9],
      ];
      const chord = chords[Math.floor(s / 4) % 4];
      const arp = chord[s % 3];
      this.note(arp * 2, t, 0.11, 'sawtooth', 0.05);
      if (s % 4 === 0) this.note(chord[0] / 2, t, 0.42, 'triangle', 0.12);
      if (s % 2 === 0) this.note(110, t, 0.1, 'square', 0.05);
    } else {
      // Island skank: offbeat chords, bass on 1 and 3.
      const chords = [
        [261.6, 329.6, 392], [293.7, 369.9, 440], [220, 261.6, 329.6], [246.9, 293.7, 369.9],
      ];
      const chord = chords[Math.floor(s / 4) % 4];
      if (s % 2 === 1) {
        for (const f of chord) this.note(f, t, 0.09, 'triangle', 0.06);
      }
      if (s === 0 || s === 8) this.note(chord[0] / 2, t, 0.3, 'sine', 0.14);
      if (s % 4 === 2) this.note(chord[1], t, 0.12, 'sine', 0.04);
    }
    this.step += 1;
  }

  note(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.radioGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
