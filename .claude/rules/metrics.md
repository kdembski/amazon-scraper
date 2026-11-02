---
paths:
  - "src/**"
---

# Scraper metrics

**Adding / changing / removing a metric updates this file in the same commit.**

## How it works

1. Code calls `MetricsService.increment(metric, { country?, outcome? }, value = 1)`. Rows with the same `metric + country + outcome` are summed.
2. `MetricsService.gauge(metric, read)` registers a reader of a point-in-time value.
3. `MetricsReporter` every minute (cron `0 * * * * *`):
   1. adds `bytes_in` / `bytes_out` from the proxies;
   2. takes the counters (`drain()`, reset); no counters → sends nothing;
   3. adds process metrics and gauges;
   4. `POST scrapers/<name>/metrics` with `{ marketplace, flow, periodStart, metrics: [...] }` and `Idempotency-Key`.
   5. Send failure → the same report (same key) goes out again before a newer one.
4. Backend (`amazon-server`, `src/modules/monitoring/`) stores `ScraperMetric`, hourly report to Discord.

Types: counters = sum over the minute; gauges = value at report time. `*_ms` as a counter = sum of durations (mean = `*_ms / event count`).

## Shop traffic (`ScrapingClient`, PDP and PLP)

| Metric | Labels | What it describes |
|---|---|---|
| `requests` | `country` (from the URL: `de`, `co.uk`, `pl`...), `outcome`: `ok` / `timeout` / `network` / `http_<status>` | Every HTTP request to Amazon. `timeout` = 20 s exceeded. |
| `request_ms` | `country` | Sum of request durations (all outcomes). Mean = `request_ms / requests`. |
| `connections` | – | New proxy sockets opened in the minute. |
| `bytes_in` / `bytes_out` | – | Bytes received / sent through proxy sockets. |

## Responses and pages

| Metric | Where | Labels | What it describes |
|---|---|---|---|
| `responses` | PDP, PLP | `country`, `outcome`: `data` / `no_data` / `captcha` / `invalid` / `empty` / `parse_error` | Parse result of a 200 response. PDP: `captcha`, `invalid`, `empty`, `parse_error` → retry. PLP: a parse exception counts as `invalid`; `captcha` → retry. |
| `items` | PDP (ASIN's country), PLP (listing page) | `country`, `outcome`: `data` / `no_data` / `deleted` / `given_up` | Final result of a unit of work. `given_up` = 6 failed attempts. `deleted` PDP only (2× 404). |
| `item_attempts` | PDP, PLP | same as `items` | Sum of attempts. Mean attempts = `item_attempts / items`. |
| `source_fallback` | PDP | `country` | 404 from a source, switch to the next one in `pdpSource`. |

## PDP

| Metric | Labels | What it describes |
|---|---|---|
| `batch_load` | `outcome`: `ok` / `empty` / `failed` | Loading an ASIN batch from `amazon/ads/scrap`. |
| `ads` | `outcome`: `prices` / `empty` / `deleted` | ASIN decided: prices sent / no price in any country / deleted. |
| `ad_duration_ms` | – | Sum of time from start to decision per ASIN. Mean = `ad_duration_ms / ads`. |
| `ads_in_flight` | – (gauge) | ASINs being processed. |

## PLP

| Metric | Labels | What it describes |
|---|---|---|
| `new_releases_pages` | `country=pl`, `outcome`: `data` / `given_up` | New releases pages: fetched / given up. |
| `new_releases_ads` | `country=pl` | New (first time in the category run) ASINs from new releases. |

## Sending to the backend (`BatchSender`)

| Metric | Labels | What it describes |
|---|---|---|
| `backend_requests` | `outcome`: `ok` / `timeout` / `network` / `http_<status>` | Every batch POST attempt (retries included). |
| `backend_send_ms` | – | Sum of attempt durations. |
| `backend_items` | `outcome`: `sent` / `dropped` | Items sent / dropped (4xx or 6 attempts). |
| `backend_buffer` | – (gauge) | Items waiting in the buffer (one `BatchSender` per mode: PDP `amazon/ads/batch`, PLP `amazon/ads`). |

## Process (added by `MetricsReporter`, at report time)

| Metric | What it describes |
|---|---|
| `pending` | Requests in progress in `TokenBucketQueue`. |
| `queue_length` | Requests waiting in the queue. |
| `open_connections` | Open proxy connections. |
| `event_loop_delay_mean_ms` / `event_loop_delay_max_ms` | Event loop delay over the minute (minus the 10 ms resolution). |
| `cpu_percent` | % of one core since the previous report. |
| `memory_rss_mb` / `heap_used_mb` | Process memory. |
| `ping_ms` / `ping_failed` | TCP ping to `1.1.1.1:443` (2 s timeout); one of the two. |

## Adding a metric

1. `increment` / `gauge` in code, labels only `country` and `outcome`.
2. New outcome → type in `src/shared/metrics/metrics.types.ts`.
3. Test in `tests/unit/...` for the source file.
4. Backend: should the hourly report show it (`amazon-server`, `src/modules/monitoring/`).
5. This file + `docs/superpowers/specs/2026-10-18-scraper-metrics-design.md`.
