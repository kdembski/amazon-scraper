---
name: amazon-pdp
description: Use when working on, debugging or explaining the Amazon PDP scraper (`-t pdp`, default mode) - prices and shipper per ASIN per country, sources aod/twister/awd, pdpSource fallback, captcha/invalid responses, retries, deleted ads, results sent to amazon/ads/batch.
---

# Amazon PDP – flow

Cel: dla każdego ASIN-a pobrać cenę i wysyłającego (`dispatchFrom`) w każdym kraju Amazona, odesłać do backendu.

**Zmiana logiki PDP (`src/marketplaces/amazon/pdp/`, `AmazonService`, `AmazonCountryService`, wspólne HTTP/backend) = aktualizacja tego pliku w tym samym commicie.**

## 1. Start procesu (`src/index.ts`, `src/marketplaces.ts`)

1. `ArgsService` czyta flagę `-t` (brak = `pdp`).
2. `ScraperConfigService.load()` pobiera `scrapers/<nazwa>/config` (`concurrency`, `rps`, `batchSize`); retry do skutku. Potem odświeżanie co minutę (cron).
3. `MetricsReporter.start("amazon")`.
4. `ProxyService.loadProxies()` – listy proxy per typ (`datacenter`, ...), odświeżane co godzinę.
5. `AmazonPdpScraper.execute()`.

## 2. Pętla batchy (`AmazonPdpScraper`)

1. Co 5 s (`POLL_INTERVAL`) wywołuje `scrape()`.
2. Jeśli kolejka requestów > `batchSize / 10` – pomija, czeka na kolejny tick.
3. Pobiera kraje: `AmazonCountryService` (`amazon/countries/scrap`, cache, odświeżany co godzinę). Kraj ma: `tld`, `priority`, `active`, `proxyType`, `pdpSource`.
4. Pobiera ASIN-y: `amazon/ads/scrap?batchSize=N`.
5. Każdy ASIN → `AmazonPdpAdScraper.execute(ad, countries)` (bez `await`, równolegle).
6. Metryka `batch_load`: `ok` / `empty` / `failed`.

## 3. Jeden ASIN (`AmazonPdpAdScraper`)

1. Tworzy `AmazonAdPrice` per kraj (`complete`, `deleted`, `failed`, `notFound`).
2. Grupuje kraje w tiery po `priority`, od najwyższego.
3. Tier po tierze: wszystkie kraje tieru równolegle, następny tier dopiero po zakończeniu poprzedniego.
4. Po każdym kraju sprawdza, czy ASIN jest już rozstrzygnięty:
   - wszystkie **aktywne** kraje `deleted` → wysyła `deleted(id)`, koniec (`ads{outcome=deleted}`);
   - wszystkie kraje `complete` **albo** ≥ 4 kraje z ceną (`PRICES_TO_COMPLETE`) → wysyła ceny, koniec (`prices` / `empty`);
   - inaczej czeka dalej.
5. Po rozstrzygnięciu `isCancelled()` = true: requesty w kolejce są porzucane, kolejne tiery się nie startują.

## 4. Jeden kraj (`AmazonPdpCountryScraper`)

1. Lista źródeł z `country.pdpSource`, np. `"twister,awd"`. Nieznane pomijane, pusta = `aod`.
2. Pętla do skutku / anulowania:
   1. `builder.buildUrl()` → request przez `AmazonService.get()` z `proxyType` kraju.
   2. **404 i jest następne źródło** → przejście na następne (`source_fallback`), bez liczenia błędu.
   3. Wynik → outcome (patrz niżej). Jest outcome → koniec kraju.
   4. Brak outcome → `failed++`; przy 6 (`MAX_FAILED_ATTEMPTS`) → `given_up`; inaczej backoff 1 s, 2 s, 4 s ... max 60 s, z jitterem.
3. Mapowanie wyniku:
   - 404 ostatniego źródła: `twister` → `no_data`; inne → `notFound++`, przy 2 (`NOT_FOUND_TO_DELETE`) → `deleted`, wcześniej retry.
   - inny błąd HTTP / timeout / sieć → retry.
   - pusta odpowiedź → retry (`responses{outcome=empty}`).
   - captcha → retry (`captcha`).
   - `isValid === false` → retry (`invalid`).
   - wyjątek parsowania → retry (`parse_error`).
   - jest cena → `data`, zapis `value` + `dispatchFrom`.
   - brak ceny, strona poprawna → `no_data`.

## 5. Źródła (builders, `pdp/builders/`)

| Źródło | URL | Co parsuje |
|---|---|---|
| `aod` | `<tld>/gp/product/ajax/aodAjaxMain/?asin=X&pc=dp` | `#aod-pinned-offer`: cena z `[id^='aod-price-']`, wysyłka z `#aod-offer-shipsFrom`. HTML ucięty przed `aod-filter`. Valid = jest `#aod-container`. |
| `twister` | `<tld>/gp/twister/ajaxv2?asinList=X&...` | JSON z częściami `&&&`; wyciąga `desktop_buybox` → `AmazonBuyboxParser`. 404 = `no_data`. |
| `awd` | `<tld>/gp/aw/d/X?th=1&psc=1` | Strona mobilna, HTML od `id="buybox"` → `AmazonBuyboxParser`. |

Wspólne:
- `AmazonCaptchaDetector`: `form` z action `/errors/validateCaptcha` lub `/errors_page/validateCaptcha`.
- `AmazonBuyboxParser`: invalid gdy brak buyboxa lub `#priceNotAvailable`; cena z `.apex-pricetopay-value` (pomija subskrypcję), fallback ukryty input koszyka; wysyłka z `desktop-fulfiller-info`, fallback `desktop-merchant-info`.
- `AmazonPriceParser`: `.a-price-whole` + `.a-price-fraction`, fallback etykieta dostępności / `.a-offscreen`.
- `AmazonDispatchFromNormalizer`: `amazon.nl` itp. → `Amazon`.

## 6. Wysyłka wyników (`AmazonPdpResultSender`)

1. `BatchSender` na `amazon/ads/batch`, max 1000 pozycji, flush co 5 s lub po zapełnieniu.
2. Body: `{ prices: [{ id, prices: [{ adId, countryId, value, dispatchFrom }] }], deleted: [id] }`. Wysyłane tylko kraje z ceną.
3. Błąd 5xx / sieć → retry z tym samym `Idempotency-Key` (max 6). 4xx → drop (`backend_items{outcome=dropped}`).

## 7. Warstwa HTTP (wspólna)

- `ScrapingClient.get()` – jedyna droga do Amazona. Losowy User-Agent Chrome, Referer, twardy timeout 20 s.
- `TokenBucketQueue` – limit `concurrency` i `rps` z configu.
- `ProxyService.getAgent(host, proxyType)` – proxy z wolnym połączeniem keep-alive do hosta, inaczej losowe; brak typu → `datacenter`.

## Gdzie szukać

- Cena się nie parsuje → builder danego źródła + test w `tests/unit/marketplaces/amazon/pdp/builders/`.
- Dużo `invalid` / `captcha` → metryka `responses` per kraj.
- ASIN za szybko „deleted” → `NOT_FOUND_TO_DELETE`, `isDeleted` (liczy tylko `active`).
