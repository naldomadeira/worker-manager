---
description: Install the Worker Manager agent skill (Claude Code plugin, zip or one-line CLI), or paste a prompt, so a coding agent wires the dashboard into your app with the right engine, adapter and auth.
---

# Set up with an AI agent

If you only want to look at a queue rather than integrate the dashboard into your app, skip all of this: the [standalone CLI](/guide/cli) does that in one command.

If you work with a coding agent (Claude Code, Cursor, Copilot, Codex, Windsurf, whatever), you don't have to hand-wire Worker Manager. Give it the **Worker Manager skill**, or paste the prompt below, and let it do the mechanical part: pick the engine and the server adapter, install the packages, mount the board, match the base path and put auth in front. Then read the diff.

## Install the agent skill

The skill is a folder, `worker-manager/`, with a `SKILL.md` and a few reference files: which engine to use (BullMQ on Redis, BullMQ v6 on PostgreSQL, pg-boss), which server adapter, which auth strategy (Basic, Keycloak, token, custom), the rules people get wrong by hand, and copy-paste setups for NestJS, Express and Fastify. It follows the [Agent Skills](https://agentskills.io) format and lives in the repository under [`skills/worker-manager`](https://github.com/naldomadeira/worker-manager/tree/main/skills/worker-manager). Pick one of three ways to install it.

### Claude Code plugin marketplace

The repository is a Claude Code plugin marketplace. In a Claude Code session:

```text
/plugin marketplace add naldomadeira/worker-manager
/plugin install worker-manager@worker-manager
```

Or from a shell: `claude plugin marketplace add naldomadeira/worker-manager && claude plugin install worker-manager@worker-manager`. `/plugin marketplace update worker-manager` pulls a newer version later.

### Download the zip

[`worker-manager-skill.zip`](https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip) is rebuilt with every docs deploy. It holds the `worker-manager/` folder at its root: unzip it into your agent's skills directory, `~/.claude/skills/` for Claude Code, or upload it where your tool accepts skill archives.

### One-line install

For every project on this machine (personal skills):

```sh
curl -fsSL https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip -o /tmp/wm-skill.zip && unzip -o /tmp/wm-skill.zip -d ~/.claude/skills/
```

For one project only, committed with it so the whole team gets it (run from the project root):

```sh
curl -fsSL https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip -o /tmp/wm-skill.zip && unzip -o /tmp/wm-skill.zip -d .claude/skills/
```

Other agents that read skill folders (the Agent Skills format) can use the same folder: unzip it into that agent's skills directory instead of `~/.claude/skills/`. Agents without skill support can be pointed at `SKILL.md` directly, or given the prompt below.

Once installed, ask for what you want in plain words, for example "add a queue dashboard to this NestJS app behind Keycloak" or "mount a pg-boss board next to our BullMQ one". The agent loads the skill on its own.

## Copy this prompt

No skill support, or you'd rather be explicit? Paste this:

```text
Add Worker Manager to my app so I can inspect my job queues in a browser.

Use the current docs at https://naldomadeira.github.io/worker-manager/llms-full.txt as the
source of truth. Don't rely on memory: the packages are @worker-manager/* (a fork of bull-board)
and the API has changed across versions.

Requirements:
- Detect my HTTP framework. On NestJS, use WorkerManagerModule from @worker-manager/nestjs
  (forRoot/forRootAsync, forFeature per queue). Otherwise install @worker-manager/api plus the
  matching @worker-manager/<framework> adapter (Express, Fastify, Koa, Hapi, Hono, H3, Elysia, Bun).
- Detect the queue library and the datastore:
  - BullMQ or Bull on Redis: wrap each existing queue in BullMQAdapter or BullAdapter.
  - BullMQ v6 on PostgreSQL (createPostgresBackend): the same BullMQAdapter; on BullMQ >= 6.3 the
    connection needs { connectionString, migrate: true } or a migration step.
  - pg-boss: use @worker-manager/pg-boss (Node >= 22.12, pg-boss >= 12.24), with
    createPgBossBoard or engine: 'pg-boss' in NestJS. Reuse my started PgBoss instance; the board
    must never start or migrate pg-boss. BullMQ and pg-boss need two boards on sibling paths.
- Reuse my existing queue instances and connections, don't create new ones.
- The base path (setBasePath or the NestJS route) and the mount path must match exactly, or the
  assets 404.
- Do not expose it unauthenticated. Use the built-in auth (@worker-manager/auth, or the NestJS
  `auth` option): basic, keycloak (OIDC with PKCE), token (Bearer/header plus a login form), or
  custom authenticate(req) around my existing auth. Read secrets from env vars; if you can't tell
  which strategy I want, use basic with env vars and tell me which ones to set.
- Show me the diff and the URL to open. Don't add options that aren't in the docs.
```

Swap the details for your case (a path, a strategy, read-only). The agent should handle the rest, including the one thing people get wrong by hand: keeping the base path and the mount path identical.

## Point your agent at the current docs

This documentation site publishes machine-readable versions of itself, generated on every build:

- [`llms.txt`](https://naldomadeira.github.io/worker-manager/llms.txt): a concise index of every page.
- [`llms-full.txt`](https://naldomadeira.github.io/worker-manager/llms-full.txt): the full text of the docs in one file.

Feed either to an agent (or an "ask the docs" tool) so it works from the current API surface instead of whatever it remembers from training. The `llms-full.txt` version is the one to use when you want it to get option names and defaults exactly right. The skill points its agent at the same files for anything it doesn't cover.

## Let an agent query your queues

Mounting the dashboard is one job; reading a running board is another. Everything the dashboard's UI does, it does over a plain JSON API. Browse it in the [interactive API reference](/api/), read it as [plain text](/reference/http-api), which is also what lands in `llms-full.txt`, or feed a tool the machine-readable [`openapi.json`](https://naldomadeira.github.io/worker-manager/openapi.json). Point an agent at any of them and it can list queues, read a failed job's stacktrace and logs, and retry jobs.

Two things to settle before you do. Give the agent its own credential: the [token strategy](/recipes/token-auth) fits best, since scripts send `Authorization: Bearer <token>` (or a header you choose) while people keep a browser login, and a [custom](/recipes/custom-auth) `authenticate(req)` can recognise whatever your app already issues. And an agent that can reach the API can reach `obliterate` as easily as a `GET`, so gate it: [read-only mode](/recipes/read-only-mode) for a board it should only observe, or an [access control hook](/recipes/access-control-hooks) that recognises the agent's identity and allows `GET` alone.

## After the agent is done

The agent gets you mounted. Check these yourself:

- Auth is on before anything is reachable from outside localhost: [Basic](/recipes/basic-auth), [Keycloak](/recipes/keycloak-auth), [token](/recipes/token-auth) or [custom](/recipes/custom-auth), with secrets in env vars rather than the diff.
- [Read-only mode](/recipes/read-only-mode) if the people opening it shouldn't be retrying or obliterating queues.
- [Alerting](/recipes/alerting): the dashboard shows failures, it doesn't tell you about them. Wire that separately.
- The [production checklist](/configuration/production-checklist).

If the page loads but looks broken, it's almost always a base-path mismatch. See [Troubleshooting](/recipes/troubleshooting).
