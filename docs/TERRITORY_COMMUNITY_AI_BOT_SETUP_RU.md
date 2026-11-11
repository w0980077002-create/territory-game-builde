# TERRITORY AI — Telegram community bot (draft, issue #485)

## Current state
Isolated **read-only group-monitoring MVP**, NOT connected to the live chat and NOT running 24/7 until configured and deployed. This does not replace the existing player login/news bot, and does not touch player accounts, purchases or gameplay.

The owner registered @TerritoryGameAI_bot and added it to «Чат Territory» on 11 Nov 2026. Never put the BotFather token into GitHub issues, commits, code, logs or screenshots. The initial BotFather screenshot contained it; rotation is recommended.

## Implemented in feature branch
- POST-only Telegram webhook with X-Telegram-Bot-Api-Secret-Token validation and no CORS.
- /start and /myid in private chat reveal only the sender's numeric Telegram ID.
- /chatid in a group, from the configured owner ID, sends that group ID privately to owner.
- Single-group allowlist, disabled-by-default switch, duplicate key by chat/message, basic RU/EN/VI keyword classification.
- Private P0 alert for possible account loss, payment or login trouble; no public auto-replies, no moderation, no Github changes.
- Original message links where possible. No previous-chat history, media analysis or transcription.

## Required Edge Function secrets (do not commit values)
- TERRITORY_COMMUNITY_BOT_TOKEN: new separate community bot token, never replace the original TELEGRAM_BOT_TOKEN/BOT_TOKEN used by game.
- TERRITORY_COMMUNITY_WEBHOOK_SECRET: independent strong random Telegram webhook secret, matching setWebhook secret_token.
- TERRITORY_COMMUNITY_OWNER_ID: owner numeric user ID, discovered with private /start.
- TERRITORY_COMMUNITY_CHAT_ID: numeric group chat ID, discovered by group /chatid after setting owner ID.
- TERRITORY_COMMUNITY_ENABLED: false until real tests pass and owner accepts.
- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: Edge runtime provided, never reveal.

## Steps after explicit separate authorization to change production Supabase
1. Review the separate SQL draft in docs/territory-community-inbox-draft.sql. Generate a proper migration with Supabase CLI and review it before applying; do not execute the draft blindly.
2. Deploy a new Edge Function named territory-community with verify_jwt=false (Telegram does not supply Supabase JWT; function verifies webhook secret itself). Set token and secret via Supabase Secrets UI, not code.
3. In Telegram Bot API configure setWebhook to the new HTTPS endpoint with the matching secret_token and allowed_updates containing message and edited_message. Keep token out of URLs exposed in logs, docs or shared browser screenshots.
4. DM @TerritoryGameAI_bot, send /start, use returned user ID to configure owner ID. In the group send /chatid from owner account; the bot privately sends its group ID. Configure group ID in secrets.
5. In @BotFather /setprivacy must be Disable, not Enable; if toggled after adding the bot, remove and re-add it. Announce to members that messages are analyzed, and implement an actual 30-day scheduled deletion BEFORE storing live group messages.
6. Test in a separate test group: wrong webhook secret, wrong chat, duplicate event, edited message, critical alert, private bot start, and noncritical silence. Only after owner approves enable the real chat.

## Known limits: do not describe as completed
- This is a keyword-based detector, NOT the ChatGPT conversation acting inside Telegram. AI translation, digest summaries, semantic grouping, and images/videos require a separate explicitly approved model provider, API credentials, budget and privacy plan.
- Telegram does not give access to group messages from before the bot was added.
- Concurrent retries can still produce duplicate alerts; use a durable outbox in the next iteration.
- No automatic data retention job exists yet; the SQL draft alone is insufficient for safe production launch.
- No production deploy, secrets or migration were modified in this branch.
