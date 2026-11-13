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
   1. adds `bytes_in` / `bytes_out` from the shop sockets, per country and route;
   2. takes the counters (`drain()`, reset); no counters → sends nothing;
   3. adds process metrics and gauges;
   4. `POST scrapers/<name>/metrics` with `{ marketplace, flow, periodStart, metrics: [...] }` and `Idempotency-Key`.
   5. 5xx / network failure → the same report (same key) goes out again before a newer one. 4xx → report dropped.
4. Backend (`amazon-server`, `src/modules/monitoring/`) stores `ScraperMetric`, hourly report to Discord.

Types: counters = sum over the minute; gauges = value at report time. `*_ms` as a counter = sum of durations (mean = `*_ms / event count`).

## Shop traffic (`ScrapingClient`, PDP and PLP)

| Metric | Labels | What it describes |
|---|---|---|
| `requests` | `country` (from the URL: `de`, `co.uk`, `pl`...), `outcome`: `ok` / `timeout` / `network` / `http_<status>` | Every HTTP request to Amazon. `timeout` = 20 s exceeded or a connect timeout (`ETIMEDOUT`). |
| `requests_proxy` / `requests_direct4` / `requests_direct6` | same as `requests` | The same requests split by route: through a proxy, direct over IPv4, direct over IPv6. Their sum = `requests`. |
| `request_ms` | `country` | Sum of request durations (all outcomes). Mean = `request_ms / requests`. |
| `connections` | `country`, `outcome`: route (`proxy` / `direct4` / `direct6`) | New sockets to shops opened in the minute. |
| `bytes_in` / `bytes_out` | `country`, `outcome`: route (`proxy` / `direct4` / `direct6`) | Bytes received / sent through shop sockets (raw socket: TLS, CONNECT and headers included). A socket is dropped from tracking on `close`, its last bytes go into the next report. |

Under `HTTP2` a shop socket is the raw TCP socket of one HTTP/2 session (many requests per socket on `direct`), so `connections` and `open_connections` count sessions; `bytes_*` still include TLS and CONNECT.

`connections` and `bytes_*` take the country from the host: `ScrapingClient` hands `ProxyService.setCountry(host, country)` the country of every request; a host never requested with a country has none. `outcome` holds the route there, not a result.

## Responses and pages

| Metric | Where | Labels | What it describes |
|---|---|---|---|
| `responses` | PDP, PLP | `country`, `outcome`: `data` / `no_data` / `captcha` / `invalid` / `empty` / `parse_error` | Parse result of a 200 response. PDP: `captcha`, `invalid`, `empty`, `parse_error` → retry. PLP: a parse exception counts as `invalid`; `captcha` → retry. |
| `items` | PDP (ASIN's country), PLP (listing page) | `country`, `outcome`: `data` / `no_data` / `deleted` / `given_up` | Final result of a unit of work. `given_up` = failed attempts limit: PDP the route `maxAttempts`, PLP 10. `deleted` PDP only (2× 404 in an active country, 1× in an inactive one). |
| `item_attempts` | PDP, PLP | same as `items` | Sum of attempts (PDP: all routes of the country). Mean attempts = `item_attempts / items`. |
| `route_fallback` | PDP | `country` | Final 404 on a route, the country moves to its next (lower-priority) route. |

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
| `new_releases_pages` | `country=pl`, `outcome`: `data` / `given_up` | New releases pages: fetched / given up. Not sent while new releases is disabled. |
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
| `open_connections` | Open shop connections (proxy and `direct`). |
| `event_loop_delay_mean_ms` / `event_loop_delay_max_ms` | Event loop delay over the minute (minus the 10 ms resolution). |
| `cpu_percent` | % of one core since the previous report. |
| `memory_rss_mb` / `heap_used_mb` | Process memory. |
| `ping_ms` / `ping_failed` | TCP ping to `1.1.1.1:443` (2 s timeout); one of the two. |

## Adding a metric

1. `increment` / `gauge` in code, labels only `country` and `outcome`.
2. New outcome → type in `src/shared/metrics/metrics.types.ts`.
3. Test in `tests/unit/...` for the source file.
4. Backend: should the hourly report show it (`amazon-server`, `src/modules/monitoring/`).
5. This file.
