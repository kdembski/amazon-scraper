---
name: amazon-plp
description: Use when working on, debugging or explaining the Amazon PLP scraper (`-t plp`) - discovering new ASINs on amazon.pl from new releases and category search listings, price-range splitting, pagination, results sent to amazon/ads.
---

# Amazon PLP – flow

Cel: znaleźć nowe ASIN-y w kategorii na amazon.pl (nowości + listing wyszukiwania) i wysłać je do backendu. Tylko kraj `pl`.

**Zmiana logiki PLP (`src/marketplaces/amazon/plp/`, `AmazonService`, wspólne HTTP/backend) = aktualizacja tego pliku w tym samym commicie.**

## 1. Start procesu

1. `npm start -- -t plp`.
2. Jak w PDP: config z backendu (`concurrency`, `rps`, `batchSize`), metryki, proxy.
3. `AmazonPlpScraper.execute()`.

## 2. Pętla kategorii (`AmazonPlpScraper`)

1. Bez przerwy, jedna kategoria naraz.
2. `amazon/ads/categories/scrap` → kategoria (`name`, `scrapedAt`).
3. `AmazonPlpCategoryScraper.execute(category)`.
4. Błąd (backend / wyjątek) → czeka 60 s, próbuje znowu.

## 3. Jedna kategoria (`AmazonPlpCategoryScraper`)

1. Tworzy `AmazonPlpCrawl(name, allPages = !scrapedAt)`:
   - `allPages = true` tylko przy pierwszym scrapie kategorii (wszystkie strony);
   - potem tylko pierwsza strona każdego przedziału cen.
2. Najpierw nowości (`AmazonNewReleasesScraper`), potem listing (`AmazonPlpPageScraper`), po kolei.
3. `crawl.post(ads)` – deduplikacja po ASIN w obrębie przebiegu, każdy ASIN wysyłany raz.

## 4. Nowości (`AmazonNewReleasesScraper`)

1. Start: `pl/gp/new-releases/<kategoria>`.
2. Z każdej strony:
   - produkty: `#gridItemRoot [data-asin]` (ASIN, `img`, nazwa z `p13n-sc-css-line-clamp`);
   - podkategorie: linki `/gp/new-releases/<kategoria>/<nodeId>`;
   - strona 2: jest link `pg=2` → pobiera `?pg=2`.
3. Rekurencyjnie wchodzi w każdą nową podkategorię (zbiór odwiedzonych nodes), równolegle.
4. Valid = jest `[class*='zg-browse-group']`.
5. Metryki: `new_releases_pages`, `new_releases_ads` (nowe ASIN-y).

## 5. Listing wyszukiwania (`AmazonPlpPageScraper`)

1. 19 przedziałów cen startowych (`SEEDS`, w groszach): `-999`, `1000-1999`, ... `500000-`.
2. Wszystkie przedziały równolegle.
3. URL: `pl/s?i=<kategoria>&rh=p_36%3A<min>-<max>&s=date-desc-rank[&page=N]` (najnowsze najpierw). Referer: losowy `pl/b?node=...`.
4. Strona 1 przedziału:
   - ostatnia strona ≥ 400 (`MAX_PAGES`, limit Amazona) → przedział dzielony na pół (`splitPriceRange`), rekurencja dla obu połówek;
   - otwarty przedział (`500000-`) dzielony na `[min, 2·min-1]` i `[2·min-]`, do 1 000 000 zł;
   - przedział jednej wartości nie jest dzielony.
5. `allPages` → strony 2..lastPage po kolei; porażka strony przerywa ten przedział.
6. Parsowanie (`AmazonPlpBuilder`):
   - produkty: `div[role='listitem']` (ASIN `data-asin`, `img`, nazwa `a > h2 > span`);
   - lastPage: max z `.s-pagination-item`;
   - valid = jest `s-search-results` **i** (są produkty **lub** komunikat „brak wyników”).
7. Metryki: `items`, `item_attempts` (`data` / `no_data` / `given_up`).

## 6. Pobieranie strony (`AmazonPlpPageFetcher`, wspólne dla 4 i 5)

1. Backpressure: kolejka requestów ≥ `batchSize` → czeka po 1 s.
2. Request przez `AmazonService.get()` (domyślne proxy `datacenter`).
3. Retry do 6 prób (`MAX_FAILED_ATTEMPTS`), backoff 1 s, 2 s, 4 s ... z jitterem, gdy:
   - błąd HTTP / sieć / timeout;
   - pusta odpowiedź (`empty`);
   - strona nie valid lub wyjątek parsowania (`invalid`).
4. Sukces → `responses{outcome=data|no_data}`.
5. 6 porażek → strona `given_up`, pomijana.

## 7. Wysyłka (`AmazonPlpAdSender`)

1. `BatchSender` na `amazon/ads`, max 2000 ASIN-ów, flush co 5 s lub po zapełnieniu.
2. Body: tablica `{ asin, name, image, categoryName }`.
3. 5xx / sieć → retry z tym samym `Idempotency-Key`; 4xx → drop.

## Gdzie szukać

- 0 produktów, dużo `invalid` → selektory w `AmazonPlpBuilder` / `AmazonNewReleasesBuilder` (psują się po cichu) + test w `tests/unit/marketplaces/amazon/plp/`.
- Brakujące ASIN-y w dużej kategorii → `MAX_PAGES`, `SEEDS`, `splitPriceRange`.
- Kategoria trwa za długo → `allPages` (pierwszy scrap) lub rozdrabnianie przedziałów.
