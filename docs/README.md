# Docs Layout

The `docs/` directory is organized by document purpose instead of keeping
everything flat.

## Buckets

- `architecture/`: system design, data flow, and implementation notes
- `reference/`: endpoint docs with methods, params, env vars, and error codes
- `runbooks/`: reusable setup and operation guides

## Key Architecture Docs

- [`architecture/runner-notify-channel-plan.md`](architecture/runner-notify-channel-plan.md): explains the runner notify mechanism, including the control plane, Cloudflare Worker, Durable Object, and fallback claim path.

## Key API Reference Docs

- [`reference/support-chat.md`](reference/support-chat.md): support backend architecture, Dify configuration, provider replacement, session handling, validation, and rollback.
- [`reference/deploy-api-lifecycle.md`](reference/deploy-api-lifecycle.md): user-facing deploy endpoints — creation, polling, removal, upgrade, listing
- [`reference/deploy-api-runner.md`](reference/deploy-api-runner.md): runner agent endpoints — job claim/ack, config sync, token rotate, preset proxy, skills
- [`reference/billing-api.md`](reference/billing-api.md): Stripe-integrated checkout, portal, usage credits, promo validation, seat lifecycle

## Notes

- This public docs set is intentionally small.
- Private operations notes, production incidents, customer support records, and
  historical planning documents are not included.
