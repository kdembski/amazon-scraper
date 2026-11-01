# CLAUDE.md

Node.js/TypeScript (ESM) worker scraping Amazon through rotating proxies. Stateless: gets work from the backend (`API_URL`), sends results back. Modes (`-t`): `pdp` (default, price and shipper per ASIN per country; sources `aod` | `twister` | `awd` from the country's `pdpSource` list, 404 falls through to the next) and `plp` (new releases + category listings on amazon.pl, sends new ASINs).

## Commands

```bash
npm start -- [-t plp]
npx tsc --noEmit
npm run test:unit | test:integration | test:e2e | test:e2e:docker | test:live
docker compose up -d --build --remove-orphans
```

Tests: `src/a/X.ts` → `tests/unit/a/X.test.ts`, one file per source file. Builder tests use minimal HTML fragments (`tests/support/html.ts`); a selector change needs a new test case. Integration/e2e use fakes in `tests/support/fake/` (`FakeBackend`, `FakeAmazon`).

## Rules

- `src/shared` knows no shop and imports nothing from `src/marketplaces`.
- Flags and backend config (`ScraperConfig`: `concurrency`, `rps`, `batchSize`) apply to every mode and marketplace; marketplace-specific behaviour goes in marketplace code.
- `ScrapingClient.get()` is the only path to shops; `TokenBucketQueue` only for shop requests. Backend results go through `BatchSender`.
- Bottleneck is open connections (NAT, conntrack): never disable keep-alive or shorten the 15 s idle timeout; set it via `agent.options.timeout` after construction (`HttpsProxyAgent` ignores the constructor option).
- HTML parsing uses `htmlparser2` + `find`/`findAll`/`text` (`@/shared/utils/html`), no full DOM. Selectors break silently. `cleanUpPrice` assumes comma decimals; `dispatchFrom` is normalized to `Amazon`.
- Flow docs: `.claude/rules/amazon/pdp.md`, `.claude/rules/amazon/plp.md`. A logic change in PDP/PLP updates the matching rule in the same commit.
- Metrics: `.claude/rules/metrics.md`, updated with every metric change. Design: `docs/superpowers/specs/2026-10-18-scraper-metrics-design.md`.

## Conventions

- Imports via `@/` (`src/`), in tests `@@tests/`.
- One class per file; plain functions only for small helpers. Method names do not repeat the class name.
- Shared services are singletons (`getInstance()`); others take defaulted constructor params as parameter properties, no `readonly`.
- 2 spaces, double quotes, semicolons, `lodash` as `_`. Comments in English.
- Brace-less arrows only when the function fits on one line.
- No `else if`, no `else` after a return: early returns.
- No comments explaining why; reasoning goes in the reply or commit.
- Commit messages: short, only what changed. No `Co-Authored-By` lines.
