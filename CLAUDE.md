# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Node.js/TypeScript (ESM) worker that scrapes Amazon through rotating proxies. No own state: it fetches work from a backend (`API_URL`) and sends results back. Two modes:

- **PDP** (default): price and shipper for a batch of ASINs in every country from the backend. Source per country (`pdpSource`): AOD AJAX fragment (`gp/product/ajax/aodAjaxMain/?asin=<asin>&pc=dp`, ~9 KB) or twister (`gp/twister/ajaxv2?asinList=<asin>&id=<asin>&parentAsin=<asin>&mType=full&json=1&isUDPFlag=1&dpxAjaxFlag=1&isFlushing=2&psc=1`, the full buy box where datacenter IPs get a degraded product page and AOD 503s; ~320 KB on the wire; cutting after the buy box part (~90 KB) is off, `CUT_RESPONSE` in `AmazonTwisterAdBuilder`; 404 for products without variations) or the mobile product page (`gp/aw/d/<asin>?th=1&psc=1`, ~600 KB; without `th=1&psc=1` products with variations have no price; an honest 404 for a product the market does not sell). `pdpSource` is a comma-separated list (`twister,awd`): a 404 moves to the next source.
- **PLP**: first the new releases ranking of the category on `amazon.pl` (`gp/new-releases/<category>`, every node of its browse tree, pages 1 and 2), then category listings, newest first, from 19 price ranges (`p_36`, grosze) split in half while a range has 400 pages (Amazon's limit, 9 600 results); all pages of a range below the limit when the category was never scraped (`scrapedAt` null), otherwise first page only; no subcategories. Categories run one after another; each ASIN goes to the backend once per run.

## Commands

```bash
npm start -- [-t plp]                      # tsx ./src/index.ts
npm run build                              # pkgroll → dist/ (used by Docker)
npx tsc --noEmit                           # type check
npm run test:unit                          # vitest
npm run test:integration                   # whole app in-process against fakes
npm run test:e2e                           # builds dist/ and runs it as a process
npm run test:e2e:docker                    # same tests against the built Docker image
npm run test:live                          # real Amazon via real proxies (PROXY_API_KEY, PROXY_LIST_TOKEN in .env)
docker compose up -d --build --remove-orphans # production
```

Tests: `src/a/X.ts` → `tests/unit/a/X.test.ts` (e.g. `tests/unit/marketplaces/amazon/pdp/builders/AmazonAodAdBuilder.test.ts`), one file per source file. Builder tests use minimal HTML fragments (`tests/support/html.ts`), not saved pages; a selector change needs a new test case.

Integration (`tests/integration/`) and e2e (`tests/e2e/`) tests share fakes in `tests/support/fake/`: `FakeBackend` (HTTP server behind `API_URL`, also serves the proxy list via `PROXY_LIST_URL`) and `FakeAmazon` (proxy that accepts CONNECT to `www.amazon.<tld>`, terminates TLS with a self-signed cert and answers from a responder). Integration runs the real object graph (`bootScraper` builds it through `createScraper()`, as `index.ts` does) with cron mocked, retry delay 0, only `setInterval` faked and non-zero `sleep` (`@/shared/utils/sleep`) running on it (`tests/support/integrationSetup.ts`); e2e spawns `node dist/index.js` (or `docker run` of the image in `e2e-docker`, reaching the fakes via `host.docker.internal`) and stays on fast paths since real backoff applies. Live tests (`tests/live/`) are a manual canary for selector breakage: blocked requests (captcha, 503) are retried and skipped, assertions only cover responses that got through; `LIVE_ASINS`/`LIVE_MARKETS` override the defaults.

## Configuration

- Env: `API_URL`, `API_TOKEN` (sent as `Authorization: Bearer` with every backend request by `ApiService`), `PROXY_API_KEY` (webshare.io API, reads the plans), `PROXY_LIST_TOKEN` (webshare.io list download), `PROXY_LIST_URL` (one list as the `datacenter` pool instead of webshare, used by e2e), `name` (set in docker-compose.yml, used in `scrapers/<name>/...`; `undefined` locally).
- Flag (`ArgsService`): only `-t pdp|plp`.
- Backend config (`ScraperConfigService`): `ScraperConfig` row of `name` in amazon-server, the only source of `concurrency` (max requests in flight, default 10), `rps` (max requests/s per process, 0 = unlimited, default 0) and `batchSize` (ads per batch in PDP / max queue length in PLP, default 50). Edited by hand in SQL; `createScraper()` waits for `GET scrapers/<name>/config` (retried until it answers), then polls it every minute and applies changes to the running queue; a failed poll keeps the last values, an invalid field is ignored.
- Flags and backend config configure the scraper as a whole, never one marketplace: every parameter must take effect in every mode (`-t`) and every marketplace. Do not add one that is ignored in some mode or marketplace; put marketplace-specific behaviour in the marketplace code.
- `uncaughtException`/`unhandledRejection` only log, so the process never crashes and Docker never restarts it. TLS verification is disabled globally.

## Structure

- `src/shared/`: code that knows no shop — `args/` (`ArgsService`), `backend/` (`ApiService`, `MetricsReporter`, `ScraperConfigService`), `metrics/` (`MetricsService`), `http/` (`TokenBucketQueue`, `ThrottledQueue`, `ScrapingClient`; `proxy/`: `ProxyService` over `ProxyList`, `ProxyAgentPool`, `ProxyTrafficMeter`), `interfaces/`, `utils/`.
- `src/marketplaces/<name>/`: one folder per shop — one scraper per flow implementing `MarketplaceScraper` (`AmazonPdpScraper`, `AmazonPlpScraper`), a thin service over `ScrapingClient`, `types/`, and one folder per flow (`amazon/pdp/`, `amazon/plp/`) holding its scrapers and builders (PDP builders and their parsers in `amazon/pdp/builders/`).
- `src/shared` imports nothing from `src/marketplaces`.
- `src/marketplaces.ts` (async `createScraper()`) loads the backend config, starts its refresh, picks the scraper for `-t` from the `scrapers` registry, starts `MetricsReporter`, waits for the proxies and returns the scraper; `src/index.ts` calls `createScraper().then((scraper) => scraper.execute())`.
- Add a shop: a `src/marketplaces/<name>/` folder with `MarketplaceScraper.marketplace` set, a `-m` flag in `ArgsService`, the choice in `createScraper()`, services in `docker-compose.yml`.

## Architecture

- `ScrapingClient.get(url, referer, callbacks, labels, proxyType, stopAt)` is the only path to shops; results go only to callbacks. `url` and `referer` are full URLs. Proxy of the `proxyType` pool whose idle connection to the host was freed last (LIFO, so idle connections nobody needs time out; `ProxyAgentPool.takeLastFree`, fed by the agents' `free` event), else a random one, a Chrome 138–141 Windows User-Agent and `Accept-Encoding: gzip, deflate, br` (axios's default contains `compress` and, with a non-Chrome UA, gets AOD 503s in de/fr/se/be even on ISP; no browser `Accept`, it triggers the "Server Busy" page on PDP via datacenter), hard 20 s `AbortSignal` timeout, one keep-alive agent per proxy. With `stopAt` (markers in order) the response is read as a stream and destroyed once the last marker arrived; `onSuccess` gets the text so far (all of it if the markers never arrive).
- `ProxyService` pools: `ProxyList` reads the active webshare plans (`GET subscription/plan/`) and downloads each plan's list (`?plan_id=`); `proxy_subtype` `default` is the `datacenter` pool, other subtypes keep their name (`isp`). An unknown or empty pool falls back to `datacenter`. Reloaded hourly.
- `AmazonService.get(url, referer, callbacks)` prefixes `https://www.amazon.` to `url` and `referer` (`de/dp/...`) and delegates to `ScrapingClient`; `AmazonService.queueService` is the `ScrapingClient` queue.
- `TokenBucketQueue`: custom concurrency limiter plus token bucket for `rps` (`setRps()` never raises the bucket, so a change gives no burst), one per process. A finished request starts the next queued one at once; a 1 ms tick starts up to 10 more (needed when the token bucket refills). Logs `rps | concurrency | pending | connections | queue` every second.
- `AmazonCountryService`: countries to scrape (`countryId`, `tld`, `active`, `proxyType`, `pdpSource`, `priority`) from `GET amazon/countries/scrap`, cached, reloaded hourly; URLs use `www.amazon.<tld>`. PDP requests go through the country's `proxyType` pool, PLP through `datacenter`.
- `-t` (`ArgsService.getTargetFlag()`: `"pdp"` by default, throws on an unknown value) picks `AmazonPdpScraper` (loads a batch, then waits 5 s) or `AmazonPlpScraper` (one category after another; a failed load or scrape waits 60 s).
- PDP flow: `AmazonPdpScraper` fetches `amazon/ads/scrap?batchSize=` when the queue is low → `AmazonPdpAdScraper` creates one `AmazonAdPrice` per country, runs `AmazonPdpCountryScraper` for each (async retry loop returning the item outcome) in tiers of equal `priority`, highest first, each tier starting after the previous one finished, and decides on the ad with `AmazonPdpPriceHelper`.
  - Captcha, empty or invalid response, network error, parse error: retry with exponential backoff; after `MAX_FAILED_ATTEMPTS` (6) failures the country finishes without a price.
  - Builders from `pdpSource`, a comma-separated list of `aod` | `twister` | `awd` (unknown entries skipped, none left means `aod`); a 404 moves to the next one at once, not counted as a failure, and retries stay on the current one. A 404 from the last one: `no_data` for twister (`notFoundIsNoData`, no price, not deleted), otherwise retried as a failure until `NOT_FOUND_TO_DELETE` (2) 404s (`AmazonAdPrice.notFound`), then deleted.
  - 404 (AOD, gp/aw/d): country deleted; once every `active` country is deleted, `DELETE amazon/ads/<id>` (inactive countries do not count; without an active country the ad is never deleted).
  - All complete, or 4 countries with a price (`PRICES_TO_COMPLETE`): `PUT amazon/ads/<id>` with prices; the ad is done and the other countries are cancelled (queued requests skipped via `isCancelled`, late responses and retries ignored); same after the DELETE.
- PLP flow: category from `amazon/ads/categories/scrap` → `AmazonPlpCategoryScraper` creates an `AmazonPlpCrawl` (category, `allPages`, ASINs sent in this run; `post()` sends only new ones to `POST amazon/ads`) and awaits `AmazonNewReleasesScraper` (`AmazonNewReleasesBuilder`; metrics `new_releases_pages`, `new_releases_ads`), then `AmazonPlpPageScraper` (`AmazonPlpBuilder`, ranges from `AmazonPlpPriceRange`; metrics `items`, `item_attempts`). Both fetch through `AmazonPlpPageFetcher`: waits while the queue holds `batchSize` requests, retries empty, invalid and failed responses with backoff up to `MAX_FAILED_ATTEMPTS`, counts `responses`.
- `MetricsService` + `MetricsReporter` send counters every minute as `POST scrapers/<name>/metrics` (catalog in `docs/superpowers/specs/2026-10-18-scraper-metrics-design.md`); a marketplace maps its results to the shared `outcome` values. Gauges `event_loop_delay_mean_ms`/`event_loop_delay_max_ms` come from `monitorEventLoopDelay` (10 ms sampling interval subtracted), reset after each send.
- `ApiService`: `get()` throws, `post`/`put`/`delete` only log errors. `put`/`delete` go through a `ThrottledQueue(5, 25)` (`concurrency` 5, `rps` 25: starts spaced 40 ms apart, per process) so batch ends do not flood the backend. Use `ThrottledQueue` for backend calls and `TokenBucketQueue` only for shop requests.

## Connection limits

The bottleneck is open connections (home router NAT, host conntrack), not bandwidth.
- Connections = `pending` (capped by `concurrency`) + idle keep-alive sockets (`maxFreeSockets: 1` per proxy × domain, closed after 15 s).
- Set the idle timeout via `agent.options.timeout` after construction; `HttpsProxyAgent` ignores `timeout` passed to the constructor.
- Do not disable keep-alive or shorten the idle timeout.
- A request with `stopAt` (twister with `CUT_RESPONSE`, off for now) destroys its socket, so it never reuses a connection and leaves one closed entry in conntrack.
- Measure with `nf_conntrack_count` on the host, or `docker exec <container> sh -c "netstat -tn | grep -c ESTABLISHED"` (not `ss` on the host).

## HTML parsing (fragile)

Builders in `src/marketplaces/amazon/pdp/builders/` (with their parsers) and `src/marketplaces/amazon/plp/` get an `htmlparser2` document (`parseDocument`) and query it with Amazon's DOM selectors through `find`/`findAll`/`text` (`@/shared/utils/html`, `css-select` + `domutils`); layout changes break them silently. No full DOM (`linkedom` was 3-4x slower).
- Captcha (PDP builders, `AmazonCaptchaDetector`): first `form` with action `/errors/validateCaptcha` or `/errors_page/validateCaptcha` ("Weiter shoppen" bot wall).
- `cleanUpPrice` assumes a comma decimal separator (EU format).
- `AmazonPlpBuilder`: a page is valid with `[data-component-type='s-search-results']` and either products or `[data-csa-c-content-id='messaging-messages-no-results']` (empty range, not retried); `lastPage` is the highest number in `.s-pagination-item`, 400 means the range is cut off.
- `AmazonAodAdBuilder` reads only `#aod-pinned-offer` (= PDP buybox); no price element means no offer. Price comes from `.a-price-whole` + `.a-price-fraction`. `Amazon.nl` etc. is normalized to `Amazon` (backend checks `dispatchFrom === "Amazon"`).
- `AmazonTwisterAdBuilder`: `trimHtml` takes the `"FeatureName" : "desktop_buybox"` JSON part and wraps its HTML in `#desktop_buybox`; `#priceNotAvailable` (degraded buy box) is invalid; price is the first `.apex-pricetopay-value` outside `#snsAccordionRowMiddle`/`#subscriptionPrice` (Subscribe & Save), else the first `items[0.base][customerVisiblePrice][amount]` input (single-offer buy box, one-time price); `dispatchFrom` from the `desktop-fulfiller-info` row, else `desktop-merchant-info`. This buy box reading is `AmazonBuyboxParser`, over `AmazonPriceParser` and `AmazonDispatchFromNormalizer` (the `Amazon` normalization), both shared with AOD.
- `AmazonAwdAdBuilder`: `trimHtml` cuts everything before `id="buybox"` (related products with their own prices come first), then `AmazonBuyboxParser` on `#buybox`; "Derzeit nicht verfügbar" pages are valid without a price.

## Conventions

- Imports via `@/` (`src/`) and, in tests, `@@tests/` (`tests/`).
- Logic lives in classes, one per file; plain exported functions only for small helpers (like `@/shared/utils`).
- Method names do not repeat the class name: `AmazonPriceParser.parse()`, not `getOfferPrice()`.
- Shared services are singletons with `getInstance()`; other classes take dependencies as defaulted constructor params. Dependencies and stored constructor args are parameter properties (`constructor(private apiService = ApiService.getInstance()) {}`), not fields assigned in the body; no `readonly`.
- Style: 2 spaces, double quotes, semicolons, `lodash` as `_`. Comments in English.
- Arrow functions without braces only when the whole function fits on one line; otherwise use a block body.
- No `else if` (and no `else` after a branch that returns): use inverted ifs with early returns.
- Do not add comments explaining why something is done; put the reasoning in the reply or the commit message instead.
- Commit messages: short, only what changed. No `Co-Authored-By` lines.
