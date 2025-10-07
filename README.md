# Lululemon Men ≤ $40 Alert Bot (No Accessories)

> **Push & play:** A single Node script that scans Lululemon pages and sends you a Telegram DM when **men’s wear** (no accessories) is **$40 or less**.

## Quick Start

1) **Create a Telegram bot**
   - In Telegram, talk to **@BotFather** → `/newbot` → follow prompts → copy your **bot token**.
   - Send **any message** to your new bot so it can DM you.
   - Get your chat id: open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and copy the `chat.id` from your last message.

2) **Configure**
   - Copy `.env.example` to `.env` and fill in:
     ```env
     TELEGRAM_BOT_TOKEN=...
     TELEGRAM_CHAT_ID=...
     CURRENCY=CAD
     PRICE_LIMIT=40
     ```

3) **Run locally**
   ```bash
   npm ci
   node bot.js
   ```
   - You’ll see “No new matches this run.” or a Telegram DM with results.

4) **Automate (GitHub Actions)**
   - Actions is preconfigured to run every 10 minutes.
   - Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to **Settings → Secrets and variables → Actions → New repository secret**.

5) **(Optional) Docker**
   ```bash
   docker build -t lulu-alerts .
   docker run --env-file .env --name lulu lulu-alerts
   ```

---

## What it scans

- Men’s “We Made Too Much” (all)
- Men’s “We Made Too Much — Under $50”
- All “We Made Too Much — Under $50” (we still filter to men)
- Like New (official resale) — Men “Finds Under $50”

Add more men’s sale subcategory pages as needed in `SEED_URLS` inside `bot.js`.

## Filters applied

- **Gender:** Men (via URL hints + breadcrumbs)
- **Category:** **Excludes accessories** (belts, bags, socks, hats, etc.)
- **Price:** `<= PRICE_LIMIT` (default 40)

## Notes

- This is a simple scraper that relies on CSS/text patterns. Retail sites change—if selectors break, tune the extractors in `bot.js`.
- Be gentle: the script sleeps between pages. Increase intervals if you add lots of sources.
- The bot stores URLs it has already sent in `seen.json` to avoid duplicates.

## License

MIT
