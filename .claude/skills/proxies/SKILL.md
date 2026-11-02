---
name: proxies
description: Use when the user asks about proxies, proxy bandwidth, concurrency, rps, errors or plans - checks live state in both Webshare accounts (PROXY_API_KEY, PROXY_API_KEY2 in .env).
---

# Proxies (Webshare)

Run from the repo root:

```bash
node --env-file=.env .claude/skills/proxies/webshare.mjs
```

Two Webshare accounts: `PROXY_API_KEY` and `PROXY_API_KEY2`. Always check both; the scraper loads proxies from both (`ProxyList`). The script goes through both keys (skips an empty one) and prints a `=== <key>` header per account.

Prints, per account and active plan for the current billing period: used and projected bandwidth vs limit, avg concurrency, avg rps, requests and error reasons, last request time, plus a daily bandwidth bar chart.

When asked about bandwidth, always report current usage and projected usage to period end, both against the limit. Flag projected > limit, `throttled`/`paused`, and a `last request` far in the past (proxies may be cut off). Report each account separately.

## API

Base `https://proxy.webshare.io/api/v2`, header `Authorization: Token $PROXY_API_KEY` (or `$PROXY_API_KEY2` for the second account). Timestamps ISO UTC.

- `GET /subscription/` - billing period (`start_date`, `end_date`), `throttled`, `paused`.
- `GET /subscription/plan/` - plans: `status`, `proxy_subtype` (`default` = datacenter, `isp`), `proxy_count`, `bandwidth_limit` (GB), `monthly_price`, `is_high_concurrency`.
- `GET /stats/aggregate/?plan_id=&timestamp__gte=&timestamp__lte=` - `bandwidth_total` (bytes), `bandwidth_projected` (bytes, extrapolated to `timestamp__lte`, so pass `end_date`), `average_concurrency`, `average_rps`, `requests_*`, `error_reasons`, `last_request_sent_at`.
- `GET /stats/?...same params` - hourly list of the same fields; `is_projected: true` entries are future estimates.

GB = 1e9 bytes (assumption; Webshare dashboard may differ slightly).
