# amazon-scraper

Stateless worker that scrapes Amazon through rotating proxies. It gets work from the backend (`API_URL`) and sends results back.

Modes (`-t`):

- `pdp` (default): price and shipper for each ASIN in each country.
- `plp`: category listings on amazon.pl, sends new ASINs.

## Stack

- Node.js 22, TypeScript (ESM), `tsx`, built with `pkgroll`
- `axios`
- `htmlparser2` + `css-select` for HTML parsing
- `cron`, `lodash`
- `vitest` (unit, integration, e2e, live tests)
- Docker / Docker Compose

## Running

Copy `.env.example` to `.env` and fill it in:

| Variable | Description |
|---|---|
| `API_URL`, `API_TOKEN` | backend URL and token |
| `PROXY_API_KEY`, `PROXY_API_KEY2` | Webshare API keys |
| `PROXY_LIST_URL` | optional: own proxy list instead of Webshare |
| `name`, `NAME_PREFIX` | scraper name (local runs; Docker Compose sets it per service) |
| `PDP_COUNT`, `PLP_COUNT` | number of replicas in Docker Compose |

Locally:

```bash
npm install
npm start            # pdp
npm start -- -t plp  # plp
```

Docker:

```bash
docker compose up -d --build --remove-orphans
```

Type check and tests:

```bash
npx tsc --noEmit
npm run test:unit
npm run test:integration
npm run test:e2e
```
