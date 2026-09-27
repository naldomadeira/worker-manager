---
pageType: home

hero:
  name: Worker Manager
  text: Dashboard for BullMQ, Bull and pg-boss
  tagline: On Redis or PostgreSQL, with Basic, Keycloak, token or custom auth built in. Mount it in NestJS, Express, Fastify or Next.js, or run it from the CLI. Install the agent skill and let your coding agent wire it up.
  image:
    src: /logo.svg
    alt: Worker Manager
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Try the demo
      link: /demo/
    - theme: brand
      text: Agent skill
      link: /guide/ai-agent-setup#install-the-agent-skill
    - theme: alt
      text: View on GitHub
      link: https://github.com/naldomadeira/worker-manager

features:
  - icon: "🤖"
    title: Agent skill, one command
    details: "Claude Code: /plugin marketplace add naldomadeira/worker-manager, then /plugin install worker-manager@worker-manager. Any other agent: unzip worker-manager-skill.zip into its skills folder."
    link: /guide/ai-agent-setup#install-the-agent-skill
  - icon: "🔐"
    title: Auth built in
    details: Basic, Keycloak / OpenID Connect with PKCE, static tokens with a login form, or your own authenticate(req), on every adapter.
  - icon: "🐘"
    title: Redis or PostgreSQL
    details: BullMQ on Redis (standalone, Sentinel, Cluster) or on PostgreSQL, plus an experimental pg-boss engine. History storage in Redis or PostgreSQL too.
  - icon: "⚡"
    title: Nothing to wire up
    details: "npx @worker-manager/cli -r redis://localhost:6379, or the official Docker image. No install, no code."
  - icon: "🧩"
    title: Or mount it in your app
    details: Adapters for Express, Fastify, Koa, Hapi, NestJS, Hono, H3, Elysia, and Bun.
  - icon: "⏰"
    title: Schedulers and history
    details: Every repeatable job in one view. Opt-in throughput and latency history that outlives BullMQ's ring buffer.
  - icon: "🔒"
    title: Safe to share
    details: Read-only mode, per-request visibility guards for multi-tenant boards, and hooks for finer access control.
  - icon: "🎨"
    title: Theming and formatters
    details: Theme tokens named after the shadcn contract, so a generated palette drops in. Formatters rewrite job data without touching your producers.
  - icon: "🐂"
    title: BullMQ v5 & v6, Pro, and Bull
    details: All three queue adapters ship in the core package, including v6 queues stored in PostgreSQL.
---
