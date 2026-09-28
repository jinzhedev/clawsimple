# ClawSimple

ClawSimple is a Next.js app for hosted OpenClaw and Hermes Agent deployments.

This public export contains the application code needed to run the web app, database schema, migrations, install endpoints, and runner notification worker. It does not include internal operations notes, private agent skills, customer support records, production credentials, or local incident reports.

## Stack

- Next.js 16 App Router
- Tailwind CSS v4
- better-auth
- Drizzle ORM
- Neon Postgres
- Stripe
- Mailgun / SendGrid
- next-intl
- Vitest

## Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Most public pages and unit tests do not need production credentials. Database, billing, email, deployment, and worker paths require the related environment variables in `.env.example`.

## Useful Commands

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test:ci
pnpm build
```

Database commands:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:check
```

## Support Chat

Homepage support uses Dify through the server-side `/api/support/chat` endpoint.
Configure `DIFY_API_URL`, `DIFY_API_KEY`, and `SUPPORT_CHAT_SESSION_SECRET`;
set `SUPPORT_CHAT_PUBLIC_ENABLED=true` after validating rollout requirements.
Self-hosted and cloud Dify use the same adapter.
See [the setup guide](docs/reference/support-chat.md) for configuration and backend replacement.

Runner notify worker:

```bash
pnpm notify:dev
pnpm notify:deploy
```

## Repository Scope

Included:

- `src/`
- `content/blog/`
- `public/`
- `drizzle/`
- `docs/`
- `scripts/db/`
- `workers/runner-notify/`

Excluded:

- internal docs and runbooks
- local/private agent skills
- customer support records
- production `.env` files
- local logs, captures, and videos
- one-off production repair scripts

Before publishing a new export, run a secret scan and review any new tracked files that mention real users, real servers, or production credentials.
