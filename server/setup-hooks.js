#!/usr/bin/env node
// Install only JOBS-owned command handlers. Never edit Codex config.toml or replace notify.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
const CLAUDE_EVENTS = ['Stop', 'SubagentStart', 'SubagentStop', 'Notification', 'PreCompact', 'SessionStart', 'SessionEnd', 'TeammateIdle', 'TaskCompleted'];

function options(args) {
  const result = { codex: false, remove: false, dryRun: false, check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--codex') result.codex = true;
    else if (arg === '--remove') result.remove = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--check') result.check = true;
    else if (['--home', '--codex-home', '--claude-home', '--url'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      result[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (result.check && (result.remove || result.dryRun)) throw new Error('--check cannot be combined with --remove or --dry-run');
  if (result.check && !result.codex) throw new Error('--check currently supports --codex; see docs/codex.md');
  return result;
}

function jsonFile(path) {
  if (!existsSync(path)) return {};
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`Cannot parse ${path}; existing file was not changed.`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Expected a JSON object in ${path}; existing file was not changed.`);
  if (data.hooks !== undefined) {
    if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) throw new Error(`Invalid hooks object in ${path}`);
    for (const entries of Object.values(data.hooks)) {
      if (!Array.isArray(entries) || entries.some(entry => !entry || !Array.isArray(entry.hooks))) throw new Error(`Invalid hook entries in ${path}; existing file was not changed.`);
    }
  }
  return data;
}

function writeChanged(path, content, dryRun) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  console.log(`[setup-hooks] ${dryRun ? 'Would write' : 'Writing'} ${path}`);
  if (dryRun) return true;
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const backup = `${path}.jobs-backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    copyFileSync(path, backup);
    console.log(`[setup-hooks] Backup: ${backup}`);
  }
  const temp = `${path}.jobs-${randomUUID()}.tmp`;
  writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
  return true;
}

// Quote Unix paths literally. A Node loader on Windows avoids shell-specific
// quoting/expansion of arbitrary config paths and the startup cost of another shell.
function shellLiteral(value) { return `'${value.replace(/'/g, `'"'"'`)}'`; }

async function main() {
  const opts = options(process.argv.slice(2));
  const configHome = resolve(opts[opts.codex ? 'codex-home' : 'claude-home'] || opts.home ||
    (opts.codex ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR) || join(homedir(), opts.codex ? '.codex' : '.claude'));
  const configPath = join(configHome, opts.codex ? 'hooks.json' : 'settings.json');
  const scriptName = opts.codex ? 'codex-hook-notify.js' : 'jobs-notify.js';
  const scriptPath = join(configHome, 'hooks', scriptName);
  const transportPath = join(configHome, 'hooks', 'codex-transport.json');
  const marker = opts.codex ? '--jobs-codex-observer-v1' : '--jobs-claude-observer-v1';
  const command = `${shellLiteral(process.execPath)} ${shellLiteral(scriptPath)} ${marker}`;
  const encodedPath = Buffer.from(scriptPath, 'utf8').toString('base64');
  const commandWindows = `node -e "process.argv[1]=Buffer.from('${encodedPath}','base64').toString();import(require('node:url').pathToFileURL(process.argv[1]).href)" -- ${marker}`;
  let url;
  try {
    const existingUrl = opts.codex && existsSync(transportPath) ? jsonFile(transportPath).url : undefined;
    url = new URL(opts.url || process.env.JOBS_URL || existingUrl || 'http://localhost:8780');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { throw new Error('Use an HTTP(S) JOBS URL without credentials, query parameters, or fragments.'); }
  const data = jsonFile(configPath);
  const before = JSON.stringify(data);
  const owned = handler => {
    if (typeof handler?.command !== 'string') return false;
    if (handler.command.endsWith(` ${marker}`)) return true;
    // Recognize only the old installer destination, not another integration's similarly named script.
    const legacyPaths = [scriptPath, join(configHome, 'hooks', 'jobs-notify.sh')];
    return !opts.codex && legacyPaths.some(path => handler.command === `node "${path}"` || handler.command === `"${path}"`);
  };
  const installed = Object.values(data.hooks || {}).flat().some(entry => entry.hooks.some(owned));
  if (opts.check) {
    console.log(`[setup-hooks] Codex handlers: ${installed ? 'installed' : 'not installed in selected home'}`);
    const headers = { 'Content-Type': 'application/json' };
    const token = process.env.JOBS_TOKEN || process.env.WEBHOOK_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${url.href.replace(/\/$/, '')}/api/codex/hooks`, {
        method: 'POST', headers, body: JSON.stringify({ diagnostic: 'jobs-delivery-check-v1' }), signal: AbortSignal.timeout(3000),
      });
    } catch { throw new Error('Server could not be reached within 3 seconds. Start JOBS and check --url/JOBS_URL and the port.'); }
    if (response.status === 401 || response.status === 403) throw new Error('Authentication failed. Export JOBS_TOKEN to match the JOBS server; credentials were not printed.');
    if (!response.ok) throw new Error(`Delivery returned HTTP ${response.status}. Check JOBS URL and that the server supports Codex hooks.`);
    const result = await response.json().catch(() => null);
    if (result?.diagnostic !== 'jobs-delivery-check-v1') throw new Error('Unexpected server response. Verify the URL targets JOBS.');
    console.log('[setup-hooks] Synthetic delivery passed; no agent or session statistics were created.');
    console.log('[setup-hooks] Review hook trust in Codex, then start a session to verify real lifecycle delivery.');
    return;
  }
  for (const [event, entries] of Object.entries(data.hooks || {})) {
    const remaining = entries.map(entry => ({ ...entry, hooks: entry.hooks.filter(handler => !owned(handler)) })).filter(entry => entry.hooks.length);
    if (remaining.length) data.hooks[event] = remaining;
    else delete data.hooks[event];
  }
  if (!opts.remove) {
    data.hooks ||= {};
    for (const event of opts.codex ? CODEX_EVENTS : CLAUDE_EVENTS) {
      const handler = {
        type: 'command', command: opts.codex ? command : process.platform === 'win32' ? `"${process.execPath}" "${scriptPath}" ${marker}` : command,
        ...(opts.codex ? { commandWindows } : {}),
        async: event !== 'SessionEnd', timeout: 3,
      };
      const entry = { ...(event === 'Notification' ? { matcher: 'permission_prompt' } : {}), hooks: [handler] };
      (data.hooks[event] ||= []).push(entry);
    }
    // Validate/read everything before the first write, so malformed configuration never gets overwritten.
    const script = readFileSync(join(ROOT, 'server', 'hooks', scriptName), 'utf8');
    writeChanged(scriptPath, script, opts.dryRun);
    if (opts.codex) writeChanged(transportPath, JSON.stringify({ url: url.href.replace(/\/$/, '') }, null, 2) + '\n', opts.dryRun);
  }
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;
  if (before !== JSON.stringify(data)) writeChanged(configPath, JSON.stringify(data, null, 2) + '\n', opts.dryRun);
  console.log(`[setup-hooks] ${opts.dryRun ? 'Dry run complete' : opts.remove ? 'JOBS handlers removed' : 'JOBS handlers installed'} (${opts.codex ? 'Codex' : 'Claude'}).`);
  if (opts.codex) console.log('[setup-hooks] config.toml and existing notify commands were preserved. Review hook trust in Codex after installation.');
  if (opts.remove) console.log('[setup-hooks] Scripts and backups are retained so existing references remain valid.');
  else if (!opts.dryRun && opts.codex) console.log('[setup-hooks] Verify delivery: node server/setup-hooks.js --codex --check (with the same home/URL options).');
}

main().catch(error => { console.error(`[setup-hooks] ${error.message}`); process.exitCode = 1; });
