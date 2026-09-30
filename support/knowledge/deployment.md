# ClawSimple Deployment

Reviewed: 2026-09-28. Sources: https://clawsimple.com/en and https://clawsimple.com/en/profile
Repository sources: `src/lib/db/schema.ts`, `src/app/api/deploy/list/route.ts`.

## Setup

Sign in to ClawSimple, choose a plan and a supported runtime, and complete the deployment setup. Supply your Telegram Bot Token and allowed Telegram User ID through the setup form. The platform provisions the cloud server and installs the selected runtime. OpenClaw and Hermes Agent are selected when creating the bot; switching an existing bot between these runtimes is not supported.

New deployments use the platform AI connection and managed search. You do not need to provide a model provider key during setup. After setup, use Telegram to chat with the bot and the profile dashboard to view deployment records.

## Deployment records versus health

The support deployment lookup returns the signed-in user's deployment names, recorded states, creation/completion times, and a dashboard link. These are product records, not a live health check of the server or Telegram connection. A completed installation does not prove that every external service is currently healthy.

An empty list means there are no deployment records for the current account. A failed lookup or expired authorization does not mean there are no deployments. Sign-in is required for account-specific records; a name, email address, or deployment ID typed into chat is not authentication.

## Problems and lifecycle changes

Use the dashboard to inspect the current record and available product actions. For failed deployment or a bot that stops responding, note the deployment name, time, and redacted error, then contact support@clawsimple.com. Do not send credentials to chat. Support chat can only read deployment records. It cannot start, stop, restart, delete, upgrade, change a subscription, or perform a refund.
