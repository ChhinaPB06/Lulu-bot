import 'dotenv/config';
import fetch from 'node-fetch';
import * as fs from 'fs';
import cheerio from 'cheerio';

/** -------------------------------------------
 *  CONFIG
 *  ------------------------------------------- */
const PRICE_LIMIT = Number(process.env.PRICE_LIMIT || 40);
const SEED_URLS = [
  // Men’s WMTM (Canada)
  "https://shop.lululemon.com/en-ca/c/men-we-made-too-much/n18mhdznrqw",
  // Men’s WMTM Under $50 (Canada)
  "https://shop.lululemon.com/en-ca/c/men-we-made-too-much/n11odkz8mhdznrqw",
  // All WMTM Under $50 (we'll still filter to men)
  "https://shop.lululemon.com/c/we-made-too-much/n11odkz8mhd",
  // Like New (official resale) — Men Finds Under $50
  "https://likenew.lululemon.com/collections/men-finds-under-50"
];

// Expand this regex as you see unwanted items in your feed.
const ACCESSORY_REGEX = /(accessor(y|ies)|belt|bag|sling|crossbody|duffle|backpack|tote|sock|beanie|hat|cap|visor|glove|mitt|scarf|balaclava|wrap|keychain|bottle|water\s*bottle|wallet|cardholder|strap|phone\s*case|armpocket|arm\s*band|yoga\s*mat|mat)/i;
const MEN_REGEX = /\bmen\b/i; // breadcrumb/URL hints

const CACHE_FILE = './seen.json';
let seen = new Set();
try {
  if (fs.existsSync(CACHE_FILE)) {
    seen = new Set(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
  }
} catch {}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** -------------------------------------------
 *  FETCH
 *  ------------------------------------------- */
async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-CA,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

// Parses "$29", "C$39", "CA$39", "$39.00"
function parsePrice(text) {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/(\$|C\$|CA\$)\s?(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[2]) : null;
}

function normalizeProduct({title, url, price, breadcrumbText}) {
  const isAccessory = ACCESSORY_REGEX.test((breadcrumbText || "") + " " + (title || ""));
  const isMen = MEN_REGEX.test(breadcrumbText || "") || /\/men[-/]/i.test(url);
  return { title, url, price, breadcrumbText, isAccessory, isMen };
}

/** -------------------------------------------
 *  EXTRACTORS
 *  ------------------------------------------- */
function extractFromLuluHTML(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];

  // Product tiles often live inside <li> or <div> with links containing /p/
  $('li,div').each((_, el) => {
    const link = $(el).find('a').attr('href');
    if (!link || !/\/p\//.test(link)) return;

    // Title from aria-label or title attr, else text
    const title = $(el).find('a').attr('aria-label') ||
                  $(el).find('[title]').attr('title') ||
                  $(el).find('a').first().text();

    // Price text — attempt a few common selectors or fallback to element text
    const priceText =
      $(el).find('[data-testid="price"], [class*="price"], .markdown-price, .product-price').text() ||
      $(el).text();

    // Breadcrumb-ish text to infer gender
    const breadcrumbText =
      $('[aria-label*="Men"], [data-breadcrumb], nav, header').text() ||
      $('header, nav').text() || '';

    const full = link.startsWith('http') ? link : new URL(link, baseUrl).toString();
    const price = parsePrice(priceText);
    if (title && price !== null) {
      items.push(normalizeProduct({ title: title.trim(), url: full, price, breadcrumbText }));
    }
  });

  // Fallback sweep if nothing found: look at anchors with /p/ and nearby price
  if (items.length === 0) {
    $('a[href*="/p/"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const title = $(a).attr('aria-label') || $(a).text() || 'Item';
      const price = parsePrice($(a).closest('div,li,article').text());
      const full = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      if (price !== null) {
        items.push(normalizeProduct({ title: title.trim(), url: full, price, breadcrumbText: $('body').text() }));
      }
    });
  }

  // Deduplicate by URL
  const byUrl = new Map(items.map(it => [it.url, it]));
  return Array.from(byUrl.values());
}

function extractFromLikeNewHTML(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];

  // Like New grid cards / product links
  $('.product-tile, .product-grid__card, a[href*="/products/"]').each((_, el) => {
    const a = $(el).is('a') ? $(el) : $(el).find('a').first();
    const link = a.attr('href');
    if (!link || !/\/products\//.test(link)) return;

    const title = a.attr('title') || $(el).find('.product-title, [class*="title"]').text() || a.text();
    const priceText = $(el).find('.price, [class*="price"]').text() || $(el).text();

    const full = link.startsWith('http') ? link : new URL(link, baseUrl).toString();
    const price = parsePrice(priceText);
    if (title && price !== null) {
      items.push(normalizeProduct({ title: title.trim(), url: full, price, breadcrumbText: 'Like New • Men' }));
    }
  });

  const byUrl = new Map(items.map(it => [it.url, it]));
  return Array.from(byUrl.values());
}

/** -------------------------------------------
 *  NOTIFY
 *  ------------------------------------------- */
async function notifyTelegram(lines) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('Telegram not configured. Skipping notification.');
    return;
  }
  const msg = lines.join('\n');
  const api = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: msg,
    disable_web_page_preview: true
  };
  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('Telegram error:', await res.text());
    }
  } catch (e) {
    console.error('Telegram fetch failed:', e.message);
  }
}

function formatLine(p) {
  const cur = process.env.CURRENCY || 'CAD';
  return `• ${p.title} — ${cur} $${p.price.toFixed(2)}\n${p.url}`;
}

/** -------------------------------------------
 *  MAIN
 *  ------------------------------------------- */
async function scrapeOne(url) {
  const html = await fetchHTML(url);
  if (/likenew\.lululemon\.com/.test(url)) return extractFromLikeNewHTML(html, url);
  return extractFromLuluHTML(html, url);
}

async function main() {
  const results = [];
  for (const url of SEED_URLS) {
    try {
      const items = await scrapeOne(url);
      for (const it of items) {
        const ok = it.isMen && !it.isAccessory && it.price <= PRICE_LIMIT;
        if (ok) results.push(it);
      }
      await sleep(1200 + Math.floor(Math.random()*400)); // gentle + jitter
    } catch (e) {
      console.error('Error on', url, e.message);
    }
  }

  // De-duplicate & only send new ones
  const byUrl = new Map(results.map(r => [r.url, r]));
  const deduped = Array.from(byUrl.values());
  const newOnes = deduped.filter(r => !seen.has(r.url));

  if (newOnes.length) {
    const header = `🧘‍♂️ Lululemon Men ≤ $${PRICE_LIMIT} — ${newOnes.length} new ${newOnes.length === 1 ? 'item' : 'items'}`;
    const lines = [header, ...newOnes.slice(0, 30).map(formatLine)];
    await notifyTelegram(lines);
    newOnes.forEach(n => seen.add(n.url));
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Array.from(seen), null, 2));
  } else {
    console.log('No new matches this run.');
  }
}

main().catch(err => console.error(err));
