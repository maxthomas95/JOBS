# Codex monitoring

JOBS observes local Codex lifecycle hooks. It does not run Codex, call the OpenAI
API, read Codex transcripts, or change approval decisions. The existing pixel
robot now follows turn starts, local tools, approval waits, compaction, turn
completion/interruption, session end, and explicit child sessions.

## Setup

Start JOBS, then preview and install from the repository:

```powershell
node server/setup-hooks.js --codex --dry-run
node server/setup-hooks.js --codex
node server/setup-hooks.js --codex --check
```

The installer selects `--codex-home PATH` (or `--home PATH`), then `CODEX_HOME`,
then `~/.codex`. Use the same home options for install, check, and removal.
`--url http://localhost:8780` selects the server and stores its address next to
the installed script. A runtime `JOBS_URL` environment variable overrides it.
Node must be available on the Codex process's `PATH` on Windows.

If the server has `JOBS_TOKEN`, export the same value in the environment that
launches Codex and runs `--check`. Tokens are read at delivery time, never written
into hooks or printed by diagnostics. `WEBHOOK_TOKEN` is a compatibility fallback
in the scripts; it does not substitute for a different server `JOBS_TOKEN`.

Installation merges JOBS handlers into `hooks.json` and copies a standalone
notifier into the selected home's `hooks/`. Existing `config.toml`, including
multiline values and other `notify` commands, stays byte-for-byte unchanged.
Existing unrelated handlers and metadata are retained, including handlers that
share an event group with JOBS. Changed files receive uniquely named backups.
Repeated install/remove is idempotent; invalid JSON fails without overwriting it.

After installation, review and trust the hook definitions in Codex and restart
the relevant client/session. Hook support can be disabled by configuration or
organization policy. The integration uses background commands except for
session end; delivery has a 1.5-second network deadline and a 2-second script
deadline. It emits no approval or continuation decisions. Codex documents
background delivery ordering, session-end behavior, trust, and local tool
coverage in its [official hooks documentation](https://learn.chatgpt.com/docs/hooks).

To remove the selected home's JOBS Codex handlers:

```powershell
node server/setup-hooks.js --codex --remove --dry-run
node server/setup-hooks.js --codex --remove
```

Removal retains scripts and backups so other references continue to resolve.
It does not remove Claude hooks. For Claude, omit `--codex` and use
`--claude-home PATH` if needed.

## What the app can report

| Delivery mode | Available observations |
| --- | --- |
| Hooks | Session/turn activity, local tool categories, approval waits, compaction, explicit child relationships |
| Notify | Turn completion only |
| Unobserved | No accepted events since this JOBS process started |

The authenticated `/api/providers` endpoint reports observed mode, last event
time, accepted/ignored totals, capabilities, and the last synthetic check.
These are observations, not a claim that every hook is installed or trusted.
Five minutes without events changes health to `stale`; an idle session may be
healthy. A synthetic check verifies URL/authentication/routing without creating
an agent or changing session statistics. A successful check does not exercise
Codex hook trust or confirm delivery from a real client.

No token usage is fabricated. Hosted search and some specialized tool paths do
not emit local tool hooks. Tool output is discarded, so nonzero exit status is
not inferred from output text. Concurrent/incomplete background delivery may
leave gaps; only observed tool starts increment tool counts. `Stop` and
`Interrupt` put the session in the attention queue until a new user turn.

The adapter retains closed turns and delivery identities to reject duplicates
and late events. Protection is bounded to 24 hours/2000 session records and
256 closed turns per session, in memory; restarting JOBS resets this history.
Turn-scoped hooks without the documented turn ID are rejected instead of
guessing which turn to update. The server's generic stale-session policy still
applies when a client never sends session end.

## Existing notify installations

`server/hooks/codex-notify.js` remains a standalone compatibility command for
an existing `notify` entry. It now sends only `agent-turn-complete` metadata to
`/api/codex/notify`; unknown event types are ignored. It discards assistant text
and working-directory paths. Hooks take precedence for a thread once observed.

The installer leaves existing notify commands and previously copied notify
scripts alone. If retaining an older JOBS notify installation, back up its copied
`codex-notify.js` and replace it with the repository's current version. Configure
its server through `JOBS_URL`. The compatibility script does not install itself
or replace another integration. Prefer hooks for new installations.

## Privacy and troubleshooting

The notifier sends an explicit metadata allowlist: event kind, bounded session/
turn/child/tool identities, a fixed tool category, source kind, and delivery
ID/time. It sends no prompt, response, raw command, search pattern, model text,
working directory, transcript path, or tool input/output. The server validates
again and hashes tool-call IDs before broadcasting them. Session identity
suffixes distinguish the otherwise anonymous Codex rows.

`--check` explains unreachable servers, authentication failure, incompatible
endpoints, and unexpected responses without printing credentials. When checks
pass but sessions stay unobserved, confirm the selected config home, hook trust,
feature/organization settings, the client environment, and a fresh session.
Hook stderr contains only fixed diagnostic messages/status codes.

Verification used installed Codex CLI `0.153.4` for version discovery, current
official docs on September 7, 2026, and synthetic Node/HTTP fixtures. Tests cover
privacy, ordering, child identities, notify compatibility, installer backups/
preservation/idempotence, and execution of the installed Windows command. No
real user configuration, prompts, or Codex session was used for these tests.
