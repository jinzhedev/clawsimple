# ClawSimple FAQ

Reviewed: 2026-09-28. Source: https://clawsimple.com/en#faq

## What is ClawSimple?

ClawSimple hosts OpenClaw or Hermes Agent on a private cloud server. Choose the runtime when creating a bot and use Telegram to talk to it. The runtime cannot be changed on an existing bot; create a new bot to use another runtime.

## What do I need for Telegram?

A Bot Token from @BotFather identifies your bot. Your numeric Telegram User ID controls who may chat with it. You can find the ID through @Getmyid_bot or @userinfobot. Enter credentials only in the product's setup form. Do not send tokens, passwords, provider keys, or payment details to support chat.

## Which model should I choose?

Start with the model preselected for your plan. You can change models later. New deployments use the platform's managed AI connection and managed search; no model provider key is required during setup.

## Can I add another agent?

An extra agent on the same deployment reuses its server. It does not add a separate server subscription, but its traffic consumes shared managed AI and search credits. Provide a fresh Telegram Bot Token and choose a platform model. The allowlist normally starts with your saved Telegram User ID.

For the OpenClaw add-agent flow, open Profile > Overview, open the deployment card, and select Add Agent. Submit the bot and model settings and wait for the job to finish. There is no fixed safe number of agents: concurrent activity and long tool calls affect capacity. Do not assume this workflow is available for every runtime.

## My deployment failed or my bot does not reply

Check the deployment status in your profile. Note the deployment name, time, and redacted error message. Do not repeatedly create paid deployments to troubleshoot. If the problem remains, contact support@clawsimple.com. Never include secret tokens in the report.

## Can support chat change my account or server?

Support chat answers documented product questions and can list the current signed-in user's deployments. It cannot create, restart, delete, upgrade, refund, change billing, or file a support ticket. For account, billing, cancellation, refund, or personal-data requests, contact support@clawsimple.com. No refund eligibility or response-time guarantee is specified in this knowledge source.
