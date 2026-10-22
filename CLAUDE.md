# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Node.js/TypeScript (ESM) worker that scrapes Amazon through rotating proxies. No own state: it fetches work from a backend (`API_URL`) and sends results back. Two modes:

- **PDP** (default): price and shipper for a batch of ASINs in every country from the backend. Source: AOD AJAX fragment (`gp/product/ajax/aodAjaxMain/?asin=<asin>&pc=dp`, ~9 KB).
- **PLP**: first the new releases ranking of the category on `amazon.pl` (`gp/new-releases/<category>`, every node of its browse tree, pages 1 and 2, each ASIN sent once per run), then category listings, newest first, in every price range, recursing into subcategories; all listing pages when the category was never scraped (`scrapedAt` null), otherwise first page only; found products go to the backend.

## Commands

```bash
npm start -- [-t plp] [-c 1000] [-l 500]   # tsx ./src/index.ts
npm run build                              # pkgroll → dist/ (used by Docker)
npx tsc --noEmit                           # type check
npm run test:unit                          # vitest
npm run test:integration                   # whole app in-process against fakes
npm run test:e2e                           # builds dist/ and runs it as a process
npm run test:e2e:docker                    # same tests against the built Docker image
npm run test:live                          # real Amazon via real proxies (PROXY_LIST_TOKEN in .env)
docker compose up -d --build --remove-orphans # production
```

Tests: `src/a/X.ts` → `tests/unit/a/X.test.ts` (e.g. `tests/unit/marketplaces/amazon/pdp/AmazonAodAdBuilder.test.ts`), one file per source file. Builder tests use minimal HTML fragments (`tests/support/html.ts`), not saved pages; a selector change needs a new test case.

Integration (`tests/integration/`) and e2e (`tests/e2e/`) tests share fakes in `tests/support/fake/`: `FakeBackend` (HTTP server behind `API_URL`, also serves the proxy list via `PROXY_LIST_URL`) and `FakeAmazon` (proxy that accepts CONNECT to `www.amazon.<tld>`, terminates TLS with a self-signed cert and answers from a responder). Integration runs the real object graph (`bootScraper` builds it through `createScraper()`, as `index.ts` does) with cron mocked, retry delay 0 and only `setInterval` faked (`tests/support/integrationSetup.ts`); e2e spawns `node dist/index.js` (or `docker run` of the image in `e2e-docker`, reaching the fakes via `host.docker.internal`) and stays on fast paths since real backoff applies. Live tests (`tests/live/`) are a manual canary for selector breakage: blocked requests (captcha, 503) are retried and skipped, assertions only cover responses that got through; `LIVE_ASINS`/`LIVE_MARKETS` override the defaults.

## Configuration

- Env: `API_URL`, `PROXY_LIST_TOKEN` (webshare.io), `PROXY_LIST_URL` (overrides the webshare list URL, used by e2e), `name` (set in docker-compose.yml, used in `scrapers/<name>/...`; `undefined` locally).
- Flags (`ArgsService`): `-t pdp|plp`, `-l` concurrency limit (default 10), `-r` max requests/s per process (default 0 = unlimited), `-c` batch size in PDP / max queue length in PLP (default 50).
- Flags configure the scraper as a whole, never one marketplace: every flag must take effect in every mode (`-t`) and every marketplace. Do not add a flag that is ignored in some mode or marketplace; put marketplace-specific behaviour in the marketplace code.
- `uncaughtException`/`unhandledRejection` only log, so the process never crashes and Docker never restarts it. TLS verification is disabled globally.

## Structure

- `src/shared/`: code that knows no shop — `args/` (`ArgsService`), `backend/` (`ApiService`, `MetricsReporter`), `metrics/` (`MetricsService`), `http/` (`RequestQueueService`, `ScrapingClient`; `proxy/`: `ProxyService` over `ProxyList`, `ProxyAgentPool`, `ProxyTrafficMeter`), `interfaces/`, `utils/`.
- `src/marketplaces/<name>/`: one folder per shop — scraper implementing `MarketplaceScraper`, a thin service over `ScrapingClient`, `types/`, and one folder per flow (`amazon/pdp/`, `amazon/plp/`) holding its scrapers and builders.
- `src/shared` imports nothing from `src/marketplaces`.
- `src/marketplaces.ts` (`createScraper()`) starts `MetricsReporter` and returns the scraper; `src/index.ts` calls `createScraper().execute()`.
- Add a shop: a `src/marketplaces/<name>/` folder with `MarketplaceScraper.marketplace` set, a `-m` flag in `ArgsService`, the choice in `createScraper()`, services in `docker-compose.yml`.

## Architecture

- `ScrapingClient.get(url, referer, callbacks)` is the only path to shops; results go only to callbacks. `url` and `referer` are full URLs. Random proxy (only among proxies with an idle connection to the host, if any) and desktop User-Agent, hard 20 s `AbortSignal` timeout, one keep-alive agent per proxy.
- `AmazonService.get(url, referer, callbacks)` prefixes `https://www.amazon.` to `url` and `referer` (`de/dp/...`) and delegates to `ScrapingClient`; `AmazonService.queueService` is the `ScrapingClient` queue.
- `RequestQueueService`: custom concurrency limiter plus token bucket for `-r`, one per process. Logs `rate | limit | pending | connections | queue` every second.
- `AmazonCountryService`: countries to scrape (`countryId`, `tld`) from `GET amazon/countries/scrap`, cached, reloaded hourly; URLs use `www.amazon.<tld>`.
- PDP flow: `AmazonScraper` fetches `amazon/ads/scrap` when the queue is low → `AmazonPdpScraper` creates one `AmazonAdPrice` per country (manual state machine) → `AmazonPdpCountryScraper` + `AmazonPdpPriceHelper`.
  - Captcha, empty or invalid response, network error: retry with exponential backoff; after 15 failures the country finishes without a price.
  - 404: country deleted; if ≤2 countries remain, `DELETE amazon/ads/<id>`.
  - All complete: `PUT amazon/ads/<id>` with prices.
- PLP flow: hourly category from `amazon/ads/categories/scrap` → `AmazonPlpScraper` awaits `AmazonNewReleasesScraper` (`AmazonNewReleasesBuilder`; a page without the browse tree is retried; metrics `new_releases_pages`, `new_releases_ads`), then starts `AmazonPlpPageScraper` → `AmazonPlpBuilder` → `POST amazon/ads`, recursing into subcategories.
- `MetricsService` + `MetricsReporter` send counters every minute as `POST scrapers/<name>/metrics` (catalog in `docs/superpowers/specs/2026-10-18-scraper-metrics-design.md`); a marketplace maps its results to the shared `outcome` values.
- `ApiService`: `get()` throws, `post`/`put`/`delete` only log errors.

## Connection limits

The bottleneck is open connections (home router NAT, host conntrack), not bandwidth.
- Connections = `pending` (capped by `-l`) + idle keep-alive sockets (`maxFreeSockets: 1` per proxy × domain, closed after 15 s).
- Set the idle timeout via `agent.options.timeout` after construction; `HttpsProxyAgent` ignores `timeout` passed to the constructor.
- Do not disable keep-alive or shorten the idle timeout.
- Measure with `nf_conntrack_count` on the host, or `docker exec <container> sh -c "netstat -tn | grep -c ESTABLISHED"` (not `ss` on the host).

## HTML parsing (fragile)

Builders in `src/marketplaces/amazon/pdp/` and `src/marketplaces/amazon/plp/` use `linkedom` and Amazon's DOM selectors; layout changes break them silently.
- `cleanUpPrice` assumes a comma decimal separator (EU format).
- `AmazonAodAdBuilder` reads only `#aod-pinned-offer` (= PDP buybox); no price element means no offer. Price comes from `.a-price-whole` + `.a-price-fraction`. `Amazon.nl` etc. is normalized to `Amazon` (backend checks `dispatchFrom === "Amazon"`).

## Conventions

- Imports via `@/` (`src/`) and, in tests, `@@tests/` (`tests/`).
- Shared services are singletons with `getInstance()`; other classes take dependencies as defaulted constructor params.
- Style: 2 spaces, double quotes, semicolons, `lodash` as `_`. Comments in English.
- Do not add comments explaining why something is done; put the reasoning in the reply or the commit message instead.
- Commit messages: short, only what changed. No `Co-Authored-By` lines.
