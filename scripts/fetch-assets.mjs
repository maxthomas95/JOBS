#!/usr/bin/env node
// Fetches purchased tileset PNGs from a private GitHub repo into src/assets/tiles/.
//
// The LimeZu Modern Office tileset license allows use in any project but forbids
// redistribution, so the images can't live in this public repo. Keeping them in a
// PRIVATE repo and pulling them at setup time keeps each machine's checkout complete
// without ever publishing the assets. Requires an authenticated GitHub CLI (`gh`).
//
// Usage:  npm run assets
// Config: JOBS_ASSETS_REPO env var overrides the source repo (owner/name).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.JOBS_ASSETS_REPO || 'maxthomas95/jobs-assets';
const FILES = ['Modern_Office_16x16.png', 'Room_Builder_Office_16x16.png'];

const destDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'tiles');
const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';

try {
  execFileSync(gh, ['auth', 'status'], { stdio: 'ignore' });
} catch {
  console.error('[assets] GitHub CLI not found or not authenticated. Install gh and run `gh auth login`.');
  console.error('[assets] (This step is optional — without the tileset, JOBS uses the procedural renderer.)');
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

let failures = 0;
for (const file of FILES) {
  try {
    const bytes = execFileSync(
      gh,
      ['api', `repos/${REPO}/contents/${file}`, '-H', 'Accept: application/vnd.github.raw'],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    writeFileSync(join(destDir, file), bytes);
    console.log(`[assets] ${file} (${(bytes.length / 1024).toFixed(0)} KB)`);
  } catch {
    failures += 1;
    console.error(`[assets] failed to fetch ${file} from ${REPO} — do you have access to that repo?`);
  }
}

if (failures > 0) {
  console.error(`[assets] ${failures}/${FILES.length} files failed. Set JOBS_ASSETS_REPO to your own private repo if needed.`);
  process.exit(1);
}
console.log(`[assets] Done. Run \`npm run build\` to bake the tiles into the production bundle.`);
