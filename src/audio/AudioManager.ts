import {
  doorBell,
  doorBellQuiet,
  keyboardClick,
  coffeeBrew,
  ambientHum,
  errorAlert,
  taskComplete,
  waitingPing,
  checkinPing,
  delegationChime,
  pageFlip,
  terminalKeystroke,
  paperShuffle,
} from './sounds.js';

export type SoundId =
  | 'door-bell'
  | 'door-bell-quiet'
  | 'keyboard-click'
  | 'page-flip'
  | 'terminal-keystroke'
  | 'paper-shuffle'
  | 'error-alert'
  | 'task-complete'
  | 'waiting-ping'
  | 'checkin-ping'
  | 'delegation-chime';

export type LoopId = 'coffee-brew' | 'ambient-hum';

const ONE_SHOT_MAP: Record<SoundId, (ctx: AudioContext, dest: AudioNode, vol: number) => void> = {
  'door-bell': doorBell,
  'door-bell-quiet': doorBellQuiet,
  'keyboard-click': keyboardClick,
  'error-alert': errorAlert,
  'task-complete': taskComplete,
  'waiting-ping': waitingPing,
  'checkin-ping': checkinPing,
  'delegation-chime': delegationChime,
  'page-flip': pageFlip,
  'terminal-keystroke': terminalKeystroke,
  'paper-shuffle': paperShuffle,
};

const LOOP_MAP: Record<LoopId, (ctx: AudioContext, dest: AudioNode, vol: number) => () => void> = {
  'coffee-brew': coffeeBrew,
  'ambient-hum': ambientHum,
};

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeLoops = new Map<LoopId, () => void>();
  private _volume = 0.5;
  private _enabled = false;

  /** Called on first user interaction to satisfy browser autoplay policy */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this._volume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(val: boolean) {
    this._enabled = val;
    if (!val) {
      this.stopAllLoops();
    }
  }

  get volume(): number {
    return this._volume;
  }

  set volume(val: number) {
    this._volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this._volume, this.ctx.currentTime);
    }
  }

  /** Play a one-shot sound */
  play(id: SoundId): void {
    if (!this._enabled || !this.ctx || !this.masterGain) return;
    const fn = ONE_SHOT_MAP[id];
    if (fn) {
      fn(this.ctx, this.masterGain, 1);
    }
  }

  /** Start a looping sound. No-op if already playing. */
  startLoop(id: LoopId): void {
    if (!this._enabled || !this.ctx || !this.masterGain) return;
    if (this.activeLoops.has(id)) return;
    const fn = LOOP_MAP[id];
    if (fn) {
      const stop = fn(this.ctx, this.masterGain, 1);
      this.activeLoops.set(id, stop);
    }
  }

  /** Stop a specific loop. */
  stopLoop(id: LoopId): void {
    const stop = this.activeLoops.get(id);
    if (stop) {
      stop();
      this.activeLoops.delete(id);
    }
  }

  /** Stop all active loops. */
  stopAllLoops(): void {
    for (const stop of this.activeLoops.values()) {
      stop();
    }
    this.activeLoops.clear();
  }

  /** Check if a loop is currently active */
  isLoopActive(id: LoopId): boolean {
    return this.activeLoops.has(id);
  }
}

/** Singleton instance */
export const audioManager = new AudioManager();
