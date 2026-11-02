---
name: proxies
description: Use when the user asks about proxies, proxy bandwidth, concurrency, rps, errors or plans - checks live state in Webshare (API key in .env).
---

# Proxies (Webshare)

Run from the repo root:

```bash
node --env-file=.env .claude/skills/proxies/webshare.mjs
```

Prints, per active plan for the current billing period: used and projected bandwidth vs limit, avg concurrency, avg rps, requests and error reasons, last request time, plus a daily bandwidth bar chart.

When asked about bandwidth, always report current usage and projected usage to period end, both against the limit. Flag projected > limit, `throttled`/`paused`, and a `last request` far in the past (proxies may be cut off).

## API

Base `https://proxy.webshare.io/api/v2`, header `Authorization: Token $PROXY_API_KEY`. Timestamps ISO UTC.

- `GET /subscription/` - billing period (`start_date`, `end_date`), `throttled`, `paused`.
- `GET /subscription/plan/` - plans: `status`, `proxy_subtype` (`default` = datacenter, `isp`), `proxy_count`, `bandwidth_limit` (GB), `monthly_price`, `is_high_concurrency`.
- `GET /stats/aggregate/?plan_id=&timestamp__gte=&timestamp__lte=` - `bandwidth_total` (bytes), `bandwidth_projected` (bytes, extrapolated to `timestamp__lte`, so pass `end_date`), `average_concurrency`, `average_rps`, `requests_*`, `error_reasons`, `last_request_sent_at`.
- `GET /stats/?...same params` - hourly list of the same fields; `is_projected: true` entries are future estimates.

GB = 1e9 bytes (assumption; Webshare dashboard may differ slightly).
