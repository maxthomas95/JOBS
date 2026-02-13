import { Container, Graphics } from 'pixi.js';

/**
 * Time periods for the day/night cycle.
 * Each defines a color overlay and alpha to tint the office scene.
 */
interface TimePeriod {
  /** Label for the period */
  name: string;
  /** Start hour (0-24) */
  startHour: number;
  /** Overlay color (hex) */
  color: number;
  /** Overlay alpha (0 = clear, max 0.3) */
  alpha: number;
}

const PERIODS: TimePeriod[] = [
  { name: 'late-night', startHour: 2, color: 0x0a1040, alpha: 0.3 },
  { name: 'dawn', startHour: 5, color: 0xff8c42, alpha: 0.1 },
  { name: 'morning', startHour: 7, color: 0xffd699, alpha: 0.03 },
  { name: 'midday', startHour: 10, color: 0xffffff, alpha: 0 },
  { name: 'afternoon', startHour: 14, color: 0xffc94d, alpha: 0.06 },
  { name: 'dusk', startHour: 17, color: 0xff6b7a, alpha: 0.15 },
  { name: 'evening', startHour: 19, color: 0x4a3080, alpha: 0.15 },
  { name: 'night', startHour: 22, color: 0x0f1860, alpha: 0.25 },
];

// Virtual midnight wraps late-night around
const TOTAL_HOURS = 24;

const OFFICE_WIDTH = 320;
const OFFICE_HEIGHT = 240;

export class DayNightCycle {
  private readonly overlay: Graphics;
  readonly container: Container;
  private _enabled = true;
  private _speedMultiplier = 1;

  constructor() {
    this.container = new Container();
    this.overlay = new Graphics();
    this.container.addChild(this.overlay);

    // Check for speed multiplier in URL params
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const speed = params.get('daynight-speed');
      if (speed) {
        const parsed = parseFloat(speed);
        if (parsed > 0 && isFinite(parsed)) {
          this._speedMultiplier = parsed;
        }
      }
    }

    // Draw initial state
    this.drawOverlay(0x000000, 0);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    if (!value) {
      this.overlay.alpha = 0;
    }
  }

  /** Called each frame from AnimationController */
  update(_deltaSeconds: number): void {
    if (!this._enabled) return;

    const now = new Date();
    const fractionalHour = this.getCurrentHour(now);
    const { color, alpha } = this.interpolate(fractionalHour);

    this.drawOverlay(color, alpha);
  }

  /** Get the current fractional hour, accounting for speed multiplier */
  private getCurrentHour(now: Date): number {
    if (this._speedMultiplier === 1) {
      return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    }
    // Accelerated: use epoch ms to create a sped-up cycle
    const msPerCycle = (24 * 60 * 60 * 1000) / this._speedMultiplier;
    const elapsed = now.getTime() % msPerCycle;
    return (elapsed / msPerCycle) * 24;
  }

  /** Find the two adjacent periods and interpolate between them */
  private interpolate(hour: number): { color: number; alpha: number } {
    // Find which period we're in and the next one
    let currentIdx = PERIODS.length - 1;
    for (let i = PERIODS.length - 1; i >= 0; i--) {
      if (hour >= PERIODS[i].startHour) {
        currentIdx = i;
        break;
      }
    }

    // Handle the wrap-around case: if hour < first period's startHour,
    // we're in the last period wrapping around midnight
    if (hour < PERIODS[0].startHour) {
      currentIdx = PERIODS.length - 1;
    }

    const current = PERIODS[currentIdx];
    const nextIdx = (currentIdx + 1) % PERIODS.length;
    const next = PERIODS[nextIdx];

    // Calculate transition progress between current and next period
    const currentStart = current.startHour;
    let nextStart = next.startHour;

    // Handle wrap-around midnight
    if (nextStart <= currentStart) {
      nextStart += TOTAL_HOURS;
    }

    let adjustedHour = hour;
    if (adjustedHour < currentStart) {
      adjustedHour += TOTAL_HOURS;
    }

    const duration = nextStart - currentStart;
    const elapsed = adjustedHour - currentStart;
    const t = Math.max(0, Math.min(1, elapsed / duration));

    // Smooth step for more natural transitions
    const smooth = t * t * (3 - 2 * t);

    const alpha = current.alpha + (next.alpha - current.alpha) * smooth;
    const color = lerpColor(current.color, next.color, smooth);

    return { color, alpha };
  }

  private drawOverlay(color: number, alpha: number): void {
    this.overlay.clear();
    if (alpha <= 0.001) {
      this.overlay.alpha = 0;
      return;
    }
    this.overlay.rect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT).fill(color);
    this.overlay.alpha = alpha;
  }

  destroy(): void {
    this.overlay.destroy();
    this.container.destroy();
  }
}

/** Linearly interpolate between two RGB hex colors */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;

  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;

  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);

  return (r << 16) | (g << 8) | blue;
}
