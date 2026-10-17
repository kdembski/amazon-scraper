# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Node.js/TypeScript (ESM) worker that scrapes Amazon through rotating proxies. No own state: it fetches work from a backend (`API_URL`) and sends results back. Two modes:

- **PDP** (default): price and shipper for a batch of ASINs in every country from the backend. Source: AOD AJAX fragment (`gp/product/ajax/aodAjaxMain/?asin=<asin>&pc=dp`, ~9 KB) or, with `-s pdp`, the full `/dp/<asin>` page (rollback).
- **PLP**: category listings on `amazon.pl`, newest first, first page only, recursing into subcategories; found products go to the backend.

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
docker compose up -d --build               # production
```

Tests: `src/a/X.ts` → `tests/unit/a/X.test.ts`, one file per source file. Builder tests use minimal HTML fragments (`tests/support/html.ts`), not saved pages; a selector change needs a new test case.

Integration (`tests/integration/`) and e2e (`tests/e2e/`) tests share fakes in `tests/support/fake/`: `FakeBackend` (HTTP server behind `API_URL`, also serves the proxy list via `PROXY_LIST_URL`) and `FakeAmazon` (proxy that accepts CONNECT to `www.amazon.<tld>`, terminates TLS with a self-signed cert and answers from a responder). Integration runs the real object graph with cron mocked, retry delay 0 and only `setInterval` faked (`tests/support/integrationSetup.ts`); e2e spawns `node dist/index.js` (or `docker run` of the image in `e2e-docker`, reaching the fakes via `host.docker.internal`) and stays on fast paths since real backoff applies. Live tests (`tests/live/`) are a manual canary for selector breakage: blocked requests (captcha, 503) are retried and skipped, assertions only cover responses that got through; `LIVE_ASINS`/`LIVE_MARKETS` override the defaults.

## Configuration

- Env: `API_URL`, `PROXY_LIST_TOKEN` (webshare.io), `PROXY_LIST_URL` (overrides the webshare list URL, used by e2e), `name` (set in docker-compose.yml, used in `scrapers/<name>/...`; `undefined` locally).
- Flags (`ArgsService`): `-t pdp|plp`, `-l` concurrency limit (default 10), `-r` max requests/s per process (default 0 = unlimited), `-s aod|pdp` (default `aod`), `-c` batch size in PDP / max queue length in PLP (default 50).
- `uncaughtException`/`unhandledRejection` only log, so the process never crashes and Docker never restarts it. TLS verification is disabled globally.

## Architecture

- `AmazonService.get(url, referer, callbacks)` is the only path to Amazon; results go only to callbacks. `url` starts with the TLD (`de/dp/...`). Random proxy and User-Agent, hard 20 s `AbortSignal` timeout, one keep-alive agent per proxy.
- `RequestQueueService`: custom concurrency limiter plus token bucket for `-r`. Its `completed`/`failed` counters are incremented by the scrapers.
- PDP flow: `AmazonScraper` fetches `amazon/ads/scrap` when the queue is low → `AmazonPdpScraper` creates one `AmazonAdPrice` per country (manual state machine) → `RequestAmazonPdpCountryScraper` + base class `AmazonPdpCountryScraper` + `AmazonPdpPriceHelper`.
  - Captcha, empty or invalid response, network error: retry with exponential backoff; after 15 failures the country finishes without a price.
  - 404: country deleted; if ≤2 countries remain, `DELETE amazon/ads/<id>`.
  - All complete: `PUT amazon/ads/<id>` with prices.
- PLP flow: hourly category from `amazon/ads/categories/scrap` → `AmazonPlpPageScraper` → `AmazonPlpBuilder` → `POST amazon/ads`, recursing into subcategories.
- `ApiService`: `get()` throws, `post`/`put`/`delete` only log errors.

## HTML parsing (fragile)

Builders in `src/builders/` use `linkedom` and Amazon's DOM selectors; layout changes break them silently.
- `cleanUpPrice` assumes a comma decimal separator (EU format).
- `AmazonAodAdBuilder` reads only `#aod-pinned-offer` (= PDP buybox); no price element means no offer. Price comes from `.a-price-whole` + `.a-price-fraction`. `Amazon.nl` etc. is normalized to `Amazon` (backend checks `dispatchFrom === "Amazon"`).
- `AmazonPdpAdPriceBuilder` takes the most frequent price across several selectors.

## Conventions

- Imports via `@/` (`src/`) and, in tests, `@@tests/` (`tests/`).
- Shared services are singletons with `getInstance()`; other classes take dependencies as defaulted constructor params.
- Style: 2 spaces, double quotes, semicolons, `lodash` as `_`. Comments in English.
- Commit messages: short, only what changed. No `Co-Authored-By` lines.
