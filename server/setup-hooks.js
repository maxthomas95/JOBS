#!/usr/bin/env node
/**
 * J.O.B.S. hook setup script.
 *
 * Reads ~/.claude/settings.json, merges the JOBS hook configuration,
 * and writes it back. Detects platform to choose the right notify script.
 *
 * Usage:
 *   node server/setup-hooks.js          # install hooks
 *   node server/setup-hooks.js --remove  # remove JOBS hooks
 *
 * Environment variables:
 *   JOBS_URL  — JOBS server URL (default: http://localhost:8780)
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const HOOKS_DIR = join(homedir(), '.claude', 'hooks');
const JOBS_URL = process.env.JOBS_URL || 'http://localhost:8780';
const isWindows = process.platform === 'win32';
const removeMode = process.argv.includes('--remove');

// Source hook scripts (relative to this file's directory)
const projectRoot = resolve(import.meta.dirname, '..');
const srcShScript = join(projectRoot, 'server', 'hooks', 'jobs-notify.sh');
const srcJsScript = join(projectRoot, 'server', 'hooks', 'jobs-notify.js');

// Destination paths
const destShScript = join(HOOKS_DIR, 'jobs-notify.sh');
const destJsScript = join(HOOKS_DIR, 'jobs-notify.js');

// Build the hook command based on platform
function getHookCommand() {
  if (isWindows) {
    // Windows: use Node.js script directly
    return `node "${destJsScript}"`;
  }
  // Unix: prefer bash script (lighter), fall back to node
  return `"${destShScript}"`;
}

// All hook events we want to subscribe to
const HOOK_EVENTS = [
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
  'TeammateIdle',
  'TaskCompleted',
];

function buildHooksConfig(command) {
  const hooks = {};
  for (const event of HOOK_EVENTS) {
    const entry = {
      hooks: [
        {
          type: 'command',
          command,
          async: true,
          timeout: 5,
          statusMessage: 'Notifying J.O.B.S. office...',
        },
      ],
    };
    // Add matcher for Notification to only fire on permission_prompt
    if (event === 'Notification') {
      entry.matcher = 'permission_prompt';
    }
    hooks[event] = hooks[event] || [];
    hooks[event].push(entry);
  }
  return hooks;
}

function readSettings() {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  mkdirSync(join(homedir(), '.claude'), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/** Check if a hook entry was created by JOBS (by checking the command) */
function isJobsHook(hookEntry) {
  return hookEntry?.hooks?.some(
    (h) => h.command?.includes('jobs-notify')
  );
}

/** Remove all JOBS-created hooks from settings */
function removeJobsHooks(settings) {
  if (!settings.hooks) return settings;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter((entry) => !isJobsHook(entry));
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return settings;
}

function copyScripts() {
  mkdirSync(HOOKS_DIR, { recursive: true });

  if (existsSync(srcShScript)) {
    copyFileSync(srcShScript, destShScript);
    if (!isWindows) {
      try { chmodSync(destShScript, 0o755); } catch { /* ignore */ }
    }
  }

  if (existsSync(srcJsScript)) {
    copyFileSync(srcJsScript, destJsScript);
  }
}

function removeScripts() {
  for (const p of [destShScript, destJsScript]) {
    try {
      if (existsSync(p)) {
        unlinkSync(p);
      }
    } catch { /* ignore */ }
  }
}

// --- Main ---

if (removeMode) {
  console.log('[setup-hooks] Removing J.O.B.S. hooks...');
  const settings = readSettings();
  removeJobsHooks(settings);
  writeSettings(settings);
  removeScripts();
  console.log('[setup-hooks] Hooks removed from', SETTINGS_PATH);
  process.exit(0);
}

console.log('[setup-hooks] Setting up J.O.B.S. Claude Code hooks...');
console.log(`[setup-hooks] Platform: ${process.platform}`);
console.log(`[setup-hooks] JOBS URL: ${JOBS_URL}`);

// 1. Copy notify scripts to ~/.claude/hooks/
copyScripts();
console.log('[setup-hooks] Copied notify scripts to', HOOKS_DIR);

// 2. Read existing settings
const settings = readSettings();

// 3. Remove any existing JOBS hooks (clean merge)
removeJobsHooks(settings);

// 4. Build and merge new hooks config
const command = getHookCommand();
const newHooks = buildHooksConfig(command);

if (!settings.hooks) {
  settings.hooks = {};
}

for (const [event, entries] of Object.entries(newHooks)) {
  if (!settings.hooks[event]) {
    settings.hooks[event] = [];
  }
  settings.hooks[event].push(...entries);
}

// 5. Write settings
writeSettings(settings);

console.log('[setup-hooks] Hooks configured in', SETTINGS_PATH);
console.log('[setup-hooks] Hook events:', HOOK_EVENTS.join(', '));
console.log('[setup-hooks] Command:', command);
console.log('');
console.log('[setup-hooks] Done! Restart Claude Code for hooks to take effect.');
console.log('[setup-hooks] To remove: node server/setup-hooks.js --remove');
