---
paths:
  - "src/marketplaces/amazon/pdp/**"
  - "src/marketplaces/amazon/*.ts"
  - "src/shared/http/**"
  - "src/shared/backend/**"
  - "tests/unit/marketplaces/amazon/pdp/**"
---

# Amazon PDP – flow

Goal: for every ASIN, get the price and the shipper (`dispatchFrom`) in every Amazon country and send them to the backend.

**A PDP logic change (`src/marketplaces/amazon/pdp/`, `AmazonService`, `AmazonCountryService`, shared HTTP/backend) updates this file in the same commit.**

## 1. Process start (`src/index.ts`, `src/marketplaces.ts`)

1. `ArgsService` reads the `-t` flag (none = `pdp`).
2. `ScraperConfigService.load()` fetches `scrapers/<name>/config` (`concurrency`, `rps`, `batchSize`); retries until it succeeds. Then refreshed every minute (cron).
3. `MetricsReporter.start("amazon")`.
4. `ProxyService.loadProxies()` – proxy lists per type (`datacenter`, ...), refreshed every hour.
5. `AmazonPdpScraper.execute()`.

## 2. Batch loop (`AmazonPdpScraper`)

1. Calls `scrape()` every 5 s (`POLL_INTERVAL`).
2. Night pause 22:00–8:00 `Europe/Warsaw` (`isNight()`, private) → skips; logs `pdp: night pause started` / `ended` on change. ASINs already loaded finish.
3. Request queue > `batchSize / 10` → skips, waits for the next tick.
4. Gets countries: `AmazonCountryService` (`amazon/countries/scrap`, cached, refreshed every minute). A country has `tld`, `priority`, `active`, `proxyType`, `pdpSource`.
5. Gets ASINs: `amazon/ads/scrap?batchSize=N` (`id`, `asin`, `skipCountryIds`: countries the backend remembers the ASIN missing in, 30 days).
6. Each ASIN → `AmazonPdpAdScraper.execute(ad, countries)` (no `await`, in parallel).
7. Metric `batch_load`: `ok` / `empty` / `failed`.

## 3. One ASIN (`AmazonPdpAdScraper`)

1. Creates an `AmazonAdPrice` per country (`complete`, `deleted`, `missing`, `failed`, `notFound`), except `skipCountryIds`; none left → `ads{outcome=empty}`, done.
2. Groups countries into tiers by `priority`, highest first.
3. Tier by tier: all countries of a tier in parallel, the next tier only after the previous one finishes.
4. After each country, checks whether the ASIN is decided:
   - all **active** countries `deleted` → sends `deleted(id)`, done (`ads{outcome=deleted}`);
   - all countries `complete` **or** ≥ 4 countries with a price (`PRICES_TO_COMPLETE`) → sends prices, done (`prices` / `empty`);
   - otherwise keeps waiting.
5. Once decided, `isCancelled()` = true: queued requests are dropped, further tiers do not start.

## 4. One country (`AmazonPdpCountryScraper`)

1. Source list from `country.pdpSource`, e.g. `"twister,awd"`. Unknown names skipped, empty = `aod`.
2. Loop until an outcome or cancellation:
   1. `builder.buildUrl()` → request via `AmazonService.get()` with the country's `proxyType`.
   2. **404 and a next source exists** → switches to the next source (`source_fallback`), not counted as a failure.
   3. Result → outcome (see below). Outcome present → country done.
   4. No outcome → `failed++`; at 6 (`MAX_FAILED_ATTEMPTS`) → `given_up`; otherwise backoff 1 s, 2 s, 4 s ... max 60 s, with jitter.
3. Result mapping:
   - 404 from the last source: `twister` → `no_data`; others → `notFound++`, at 2 (`NOT_FOUND_TO_DELETE`) in an active country, at 1 in an inactive one → `deleted`, before that retry. Both final cases set `missing`.
   - other HTTP error / timeout / network → retry; 403, 429 and 503 also block the direct family for the host (see 7).
   - empty response → retry (`responses{outcome=empty}`).
   - captcha → blocks the direct family for the host (see 7), retry (`captcha`).
   - `isValid === false` → retry (`invalid`).
   - parse exception → retry (`parse_error`).
   - price found → `data`, stores `value` + `dispatchFrom`.
   - no price, valid page → `no_data`.

## 5. Sources (builders, `pdp/builders/`)

| Source | URL | What it parses |
|---|---|---|
| `aod` | `<tld>/gp/product/ajax/aodAjaxMain/?asin=X&pc=dp` | `#aod-pinned-offer`: price from `[id^='aod-price-']`, shipper from `#aod-offer-shipsFrom`. HTML cut before `aod-filter`. Valid = `#aod-container` present. |
| `twister` | `<tld>/gp/twister/ajaxv2?asinList=X&...` | JSON parts separated by `&&&`; takes `desktop_buybox` → `AmazonBuyboxParser`. Download stops inside the buy box part at the `desktop-return-info` row (after price and shipper; not the `-collapsed` accordion header), at the latest at the `&&&` that ends the part; the cut JSON string is decoded up to the cut. 404 = `no_data`. |
| `awd` | `<tld>/gp/aw/d/X?th=1&psc=1` | Mobile page, HTML from `id="buybox"` → `AmazonBuyboxParser`. Download stops at `id="olpLinkWidget_feature_div"` after the buy box. |

Shared:
- `AmazonCaptchaDetector`: `form` with action `/errors/validateCaptcha` or `/errors_page/validateCaptcha`, or the Akamai interstitial (`meta[http-equiv='refresh']` with `bm-verify=`).
- `AmazonBuyboxParser`: invalid when there is no buy box or `#priceNotAvailable`; price from `.apex-pricetopay-value` (skips subscription), fallback hidden cart input; shipper from `desktop-fulfiller-info`, fallback `desktop-merchant-info`.
- `AmazonPriceParser`: `.a-price-whole` + `.a-price-fraction`, fallback accessibility label / `.a-offscreen`.
- `AmazonDispatchFromNormalizer`: `amazon.nl` etc. → `Amazon`.

## 6. Sending results (`AmazonPdpResultSender`)

1. `BatchSender` on `amazon/ads/batch`, max 1000 items, flush every 5 s or when full.
2. Body: `{ prices: [{ id, prices: [{ adId, countryId, value, dispatchFrom }], missingCountryIds }], deleted: [id] }`. Only countries with a price are sent; `missingCountryIds` = countries with `missing` (backend stores them in `AmazonAdMissing`).
3. 5xx / network error → retry with the same `Idempotency-Key` (max 6). 4xx → dropped (`backend_items{outcome=dropped}`).

## 7. HTTP layer (shared)

- `ScrapingClient.get()` – the only path to Amazon. Random Chrome User-Agent, Referer, hard 20 s timeout. With the builder's `stopAt` markers it reads a stream and destroys it (closes the connection) once they arrived in order; a step given as an array is done by whichever of its markers comes first.
- `TokenBucketQueue` – `concurrency` and `rps` limits from the config.
- `ProxyService.getAgent(host, proxyType)` – proxy with a free keep-alive connection to the host, otherwise random; missing type → `datacenter`. `direct` → no proxy, keep-alive agents per IP family (`ProxyAgentPool.getDirect(4 | 6)`, 15 s idle timeout), IPv4 and IPv6 in turn; IPv6 only when a TCP ping to `2606:4700:4700::1111:443` succeeds at each proxy list load (start, hourly; Docker network needs `enable_ipv6`). `mixedN/M` (e.g. `mixed1/2`) → `direct` for N minutes, then the `datacenter` pool for M minutes, by wall clock (all processes of a server switch together); `mixedN` = `mixedN/N`. While the host blocks every direct family, `direct` and `mixedN/M` use the `datacenter` pool.
- Block (`ProxyAgentPool.block`): a 403, 429 or 503 (`ScrapingClient`) or a captcha (`block` passed to `onSuccess`) on a direct agent closes its idle connections to the host and blocks the direct family + host for 5 min: its connections are closed when freed and picks skip it (all direct families blocked → `datacenter`). Proxy agents are not blocked. Amazon limits IPv6 per /64, so the direct IPv6 agent stands for the whole /64.

## Where to look

- Price not parsed → the source's builder + test in `tests/unit/marketplaces/amazon/pdp/builders/`.
- Many `invalid` / `captcha` → `responses` metric per country.
- ASIN "deleted" too early → `NOT_FOUND_TO_DELETE`, `isDeleted` (counts only `active`).
