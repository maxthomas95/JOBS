import { Howl, Howler } from 'howler';
import {
  type SoundId,
  type LoopId,
  SOUND_URLS,
  LOOP_URLS,
  LOOP_VOLUMES,
  SOUND_VOLUMES,
} from './sounds.js';

export type { SoundId, LoopId };

class AudioManager {
  private sounds = new Map<SoundId, Howl>();
  private loops = new Map<LoopId, Howl>();
  private activeLoops = new Set<LoopId>();
  /** Pending fade-out timeouts so we can cancel them if a loop restarts */
  private fadeTimeouts = new Map<LoopId, ReturnType<typeof setTimeout>>();
  private loaded = false;
  private _volume = 0.5;
  private _enabled = false;

  /** Called on first user interaction to satisfy browser autoplay policy */
  unlock(): void {
    if (!this.loaded) {
      this.preload();
    }
    // Unlock the global Howler AudioContext (must happen in a user gesture)
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume();
    }
  }

  private preload(): void {
    this.loaded = true;

    // Load one-shot sounds
    for (const [id, url] of Object.entries(SOUND_URLS) as [SoundId, string][]) {
      this.sounds.set(id, new Howl({ src: [url], preload: true }));
    }

    // Load loop sounds
    for (const [id, url] of Object.entries(LOOP_URLS) as [LoopId, string][]) {
      this.loops.set(
        id,
        new Howl({
          src: [url],
          loop: true,
          preload: true,
          volume: LOOP_VOLUMES[id] * this._volume,
        }),
      );
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(val: boolean) {
    this._enabled = val;
    if (val && !this.loaded) {
      this.preload();
    }
    if (!val) {
      this.stopAllLoops();
    }
  }

  get volume(): number {
    return this._volume;
  }

  set volume(val: number) {
    this._volume = Math.max(0, Math.min(1, val));
    // Update all loop volumes
    for (const [id, howl] of this.loops) {
      howl.volume(LOOP_VOLUMES[id] * this._volume);
    }
  }

  /** Play a one-shot sound */
  play(id: SoundId): void {
    if (!this._enabled) {
      console.log(`[audio] play(${id}) skipped — disabled`);
      return;
    }
    const howl = this.sounds.get(id);
    if (howl) {
      const vol = SOUND_VOLUMES[id] * this._volume;
      console.log(`[audio] play(${id}) vol=${vol.toFixed(2)} state=${howl.state()}`);
      howl.volume(vol);
      howl.play();
    } else {
      console.warn(`[audio] play(${id}) — no Howl instance found! loaded=${this.loaded}`);
    }
  }

  /** Start a looping sound. No-op if already playing. */
  startLoop(id: LoopId): void {
    if (!this._enabled) return;
    if (this.activeLoops.has(id)) return;

    // Cancel any pending fade-out from a recent stopLoop
    const pending = this.fadeTimeouts.get(id);
    if (pending) {
      clearTimeout(pending);
      this.fadeTimeouts.delete(id);
      console.log(`[audio] startLoop(${id}) — cancelled pending fade-out`);
    }

    const howl = this.loops.get(id);
    if (howl) {
      const targetVol = LOOP_VOLUMES[id] * this._volume;
      if (howl.playing()) {
        // Was fading out — restore volume instead of starting a new instance
        howl.volume(targetVol);
        console.log(`[audio] startLoop(${id}) — restored fading instance`);
      } else {
        howl.volume(targetVol);
        howl.play();
        console.log(`[audio] startLoop(${id}) — new play`);
      }
      this.activeLoops.add(id);
    }
  }

  /** Stop a specific loop. */
  stopLoop(id: LoopId): void {
    if (!this.activeLoops.has(id)) return;
    this.activeLoops.delete(id);
    console.log(`[audio] stopLoop(${id})`);

    const howl = this.loops.get(id);
    if (howl) {
      howl.fade(howl.volume(), 0, 300);
      const timeout = setTimeout(() => {
        howl.stop();
        howl.volume(LOOP_VOLUMES[id] * this._volume);
        this.fadeTimeouts.delete(id);
      }, 350);
      this.fadeTimeouts.set(id, timeout);
    }
  }

  /** Stop all active loops. */
  stopAllLoops(): void {
    for (const id of [...this.activeLoops]) {
      this.stopLoop(id);
    }
  }

  /** Check if a loop is currently active */
  isLoopActive(id: LoopId): boolean {
    return this.activeLoops.has(id);
  }
}

/** Singleton instance */
export const audioManager = new AudioManager();
