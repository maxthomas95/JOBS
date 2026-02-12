/**
 * Procedural sound synthesis using Web Audio API.
 * Each function creates short-lived audio nodes and schedules their playback.
 */

/** Two-tone ascending chime (C5 -> E5), 0.5s */
export function doorBell(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(volume * 0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(523.25, now); // C5
  osc1.connect(gain);
  osc1.start(now);
  osc1.stop(now + 0.25);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(659.25, now + 0.2); // E5
  osc2.connect(gain);
  osc2.start(now + 0.2);
  osc2.stop(now + 0.5);
}

/** Quieter door bell for session.ended */
export function doorBellQuiet(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(volume * 0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(659.25, now); // E5 descending
  osc1.connect(gain);
  osc1.start(now);
  osc1.stop(now + 0.2);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(523.25, now + 0.15); // C5
  osc2.connect(gain);
  osc2.start(now + 0.15);
  osc2.stop(now + 0.4);
}

/** Short noise burst shaped like a mechanical key press, ~30ms */
export function keyboardClick(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const duration = 0.025 + Math.random() * 0.015;

  // White noise buffer
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Bandpass filter: mid-range thud, not metallic high ring
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800 + Math.random() * 600, now);
  filter.Q.setValueAtTime(0.5, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * 0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}

/** Gentle bubbling/percolating coffee sound — returns stop function */
export function coffeeBrew(ctx: AudioContext, dest: AudioNode, volume: number): () => void {
  const now = ctx.currentTime;

  // Soft pink-ish noise shaped to sound like liquid bubbling
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + 0.1848 * b2) * 0.06;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Bandpass to keep it mid-range and gentle, not rumbly
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, now);
  filter.Q.setValueAtTime(0.4, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.03, now + 0.5);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);

  return () => {
    const t = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    setTimeout(() => { try { source.stop(); } catch {} }, 400);
  };
}

/** Very soft pink noise — like distant HVAC / office air. Returns stop function */
export function ambientHum(ctx: AudioContext, dest: AudioNode, volume: number): () => void {
  const now = ctx.currentTime;

  // Pink noise buffer (gentle, no harsh frequencies)
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.025;
    b6 = white * 0.115926;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Gentle lowpass to soften it further
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.Q.setValueAtTime(0, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.015, now + 2);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);

  return () => {
    const t = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0, t + 1);
    setTimeout(() => { try { source.stop(); } catch {} }, 1200);
  };
}

/** Harsh descending square wave (C4 -> C3), 0.8s */
export function errorAlert(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;

  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(volume * 0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(261.63, now); // C4
  osc.frequency.exponentialRampToValueAtTime(130.81, now + 0.8); // C3
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.8);
}

/** Ascending arpeggio C5-E5-G5-C6, 1s */
export function taskComplete(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  const noteLen = 0.2;

  for (let i = 0; i < notes.length; i++) {
    const t = now + i * noteLen;
    const gain = ctx.createGain();
    gain.connect(dest);
    gain.gain.setValueAtTime(volume * 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + noteLen + 0.1);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + noteLen + 0.1);
  }
}

/** Gentle sine ping at C6, 0.3s */
export function waitingPing(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;

  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(volume * 0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1046.5, now); // C6
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.3);
}

/** Two soft pings E5 -> G5, 0.4s */
export function checkinPing(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;

  const gain1 = ctx.createGain();
  gain1.connect(dest);
  gain1.gain.setValueAtTime(volume * 0.12, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(659.25, now); // E5
  osc1.connect(gain1);
  osc1.start(now);
  osc1.stop(now + 0.2);

  const gain2 = ctx.createGain();
  gain2.connect(dest);
  gain2.gain.setValueAtTime(volume * 0.12, now + 0.2);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(783.99, now + 0.2); // G5
  osc2.connect(gain2);
  osc2.start(now + 0.2);
  osc2.stop(now + 0.4);
}

/** Soft page-flip sound for reading — brief filtered noise sweep, ~60ms */
export function pageFlip(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const duration = 0.06 + Math.random() * 0.02;

  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Bandpass sweep — gives a swishy quality
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1200 + Math.random() * 400, now);
  filter.frequency.linearRampToValueAtTime(3000, now + duration);
  filter.Q.setValueAtTime(0.3, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * 0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}

/** Terminal keystroke — slightly lower/thumpier than keyboard click, ~25ms */
export function terminalKeystroke(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const duration = 0.02 + Math.random() * 0.01;

  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.4;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Lower bandpass than keyboard — more mechanical/clunky
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500 + Math.random() * 300, now);
  filter.Q.setValueAtTime(0.6, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * 0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}

/** Paper shuffle for searching — softer, wider noise burst, ~80ms */
export function paperShuffle(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const duration = 0.07 + Math.random() * 0.03;

  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.25;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Wide bandpass — rustly quality
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1500 + Math.random() * 800, now);
  filter.Q.setValueAtTime(0.2, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * 0.04, now);
  gain.gain.linearRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}

/** Three-note motif G4-B4-D5, 0.6s */
export function delegationChime(ctx: AudioContext, dest: AudioNode, volume: number): void {
  const now = ctx.currentTime;
  const notes = [392.0, 493.88, 587.33]; // G4, B4, D5
  const noteLen = 0.15;

  for (let i = 0; i < notes.length; i++) {
    const t = now + i * noteLen;
    const gain = ctx.createGain();
    gain.connect(dest);
    gain.gain.setValueAtTime(volume * 0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + noteLen + 0.1);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + noteLen + 0.1);
  }
}
