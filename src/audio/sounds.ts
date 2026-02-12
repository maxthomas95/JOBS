/**
 * Sound registry — maps sound IDs to .ogg file imports.
 * Vite resolves these imports to hashed asset URLs at build time.
 */

// --- Loop sounds ---
import typingUrl from '../assets/audio/typing.ogg';
import typewriterUrl from '../assets/audio/typewriter.ogg';
import turningPagesUrl from '../assets/audio/turning-pages.ogg';
import rustlingPaperUrl from '../assets/audio/rustling-paper.ogg';
import coffeeUrl from '../assets/audio/coffee.ogg';
import humUrl from '../assets/audio/hum.ogg';
import footstepsUrl from '../assets/audio/footsteps.ogg';

// --- One-shot sounds ---
import doorBellUrl from '../assets/audio/door-bell-arrival.ogg';
import goodbyeUrl from '../assets/audio/goodbye.ogg';
import errorUrl from '../assets/audio/error.ogg';
import completeUrl from '../assets/audio/complete.ogg';
import pingUrl from '../assets/audio/ping.ogg';
import checkinUrl from '../assets/audio/checkin.ogg';
import delegationUrl from '../assets/audio/delegation.ogg';

export type SoundId =
  | 'door-bell'
  | 'door-bell-quiet'
  | 'error-alert'
  | 'task-complete'
  | 'waiting-ping'
  | 'checkin-ping'
  | 'delegation-chime';

export type LoopId =
  | 'keyboard-typing'
  | 'terminal-typing'
  | 'page-turning'
  | 'paper-rustling'
  | 'coffee-brew'
  | 'ambient-hum'
  | 'footsteps';

export const SOUND_URLS: Record<SoundId, string> = {
  'door-bell': doorBellUrl,
  'door-bell-quiet': goodbyeUrl,
  'error-alert': errorUrl,
  'task-complete': completeUrl,
  'waiting-ping': pingUrl,
  'checkin-ping': checkinUrl,
  'delegation-chime': delegationUrl,
};

export const LOOP_URLS: Record<LoopId, string> = {
  'keyboard-typing': typingUrl,
  'terminal-typing': typewriterUrl,
  'page-turning': turningPagesUrl,
  'paper-rustling': rustlingPaperUrl,
  'coffee-brew': coffeeUrl,
  'ambient-hum': humUrl,
  'footsteps': footstepsUrl,
};

/** Default volumes per loop (relative to master, 0-1) */
export const LOOP_VOLUMES: Record<LoopId, number> = {
  'keyboard-typing': 0.8,
  'terminal-typing': 0.7,
  'page-turning': 0.3,
  'paper-rustling': 0.35,
  'coffee-brew': 0.5,
  'ambient-hum': 0.3,
  'footsteps': 0.25,
};

/** Default volumes per one-shot (relative to master, 0-1) */
export const SOUND_VOLUMES: Record<SoundId, number> = {
  'door-bell': 0.8,
  'door-bell-quiet': 0.6,
  'error-alert': 0.9,
  'task-complete': 0.8,
  'waiting-ping': 0.15,
  'checkin-ping': 0.7,
  'delegation-chime': 0.8,
};
