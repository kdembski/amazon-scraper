---
name: metrics
description: Use when working on, debugging or explaining scraper metrics - MetricsService counters and gauges, MetricsReporter minute report to scrapers/<name>/metrics, metric names, labels (country, outcome), what a given metric counts, adding a new metric.
---

# Metryki scrapera

**Dodanie / zmiana / usunięcie metryki = aktualizacja tego pliku w tym samym commicie.**

## Jak to działa

1. Kod woła `MetricsService.increment(metric, { country?, outcome? }, value = 1)`. Wiersze o tym samym `metric + country + outcome` są sumowane.
2. `MetricsService.gauge(metric, read)` rejestruje odczyt chwilowej wartości.
3. `MetricsReporter` co minutę (cron `0 * * * * *`):
   1. dolicza `bytes_in` / `bytes_out` z proxy;
   2. zabiera liczniki (`drain()`, zerowanie); brak liczników → nic nie wysyła;
   3. dokłada metryki procesu i gauge;
   4. `POST scrapers/<nazwa>/metrics` z `{ marketplace, flow, periodStart, metrics: [...] }` i `Idempotency-Key`.
   5. Błąd wysyłki → ten sam raport (ten sam klucz) idzie ponownie przed nowym.
4. Backend (`amazon-server`, `src/modules/monitoring/`) zapisuje `ScraperMetric`, co godzinę raport na Discord.

Typy: liczniki = suma w minucie; gauge = wartość w chwili raportu. `*_ms` jako licznik = suma czasów (średnia = `*_ms / liczba zdarzeń`).

## Ruch do sklepu (`ScrapingClient`, PDP i PLP)

| Metryka | Labels | Co opisuje |
|---|---|---|
| `requests` | `country` (z URL: `de`, `co.uk`, `pl`...), `outcome`: `ok` / `timeout` / `network` / `http_<status>` | Każdy request HTTP do Amazona. `timeout` = przekroczone 20 s. |
| `request_ms` | `country` | Suma czasu requestów (wszystkich outcome). Średnia = `request_ms / requests`. |
| `connections` | – | Nowe sockety proxy otwarte w minucie. |
| `bytes_in` / `bytes_out` | – | Bajty odebrane / wysłane przez sockety proxy. |

## Odpowiedzi i strony

| Metryka | Gdzie | Labels | Co opisuje |
|---|---|---|---|
| `responses` | PDP, PLP | `country`, `outcome`: `data` / `no_data` / `captcha` / `invalid` / `empty` / `parse_error` | Wynik parsowania odpowiedzi 200. PDP: `captcha`, `invalid`, `empty`, `parse_error` → retry. PLP: wyjątek parsowania liczony jako `invalid`, `captcha` nie występuje. |
| `items` | PDP (kraj ASIN-a), PLP (strona listingu) | `country`, `outcome`: `data` / `no_data` / `deleted` / `given_up` | Wynik końcowy jednostki pracy. `given_up` = 6 nieudanych prób. `deleted` tylko PDP (2× 404). |
| `item_attempts` | PDP, PLP | jak `items` | Suma prób. Średnio prób = `item_attempts / items`. |
| `source_fallback` | PDP | `country` | 404 ze źródła, przejście na następne z `pdpSource`. |

## PDP

| Metryka | Labels | Co opisuje |
|---|---|---|
| `batch_load` | `outcome`: `ok` / `empty` / `failed` | Pobranie batcha ASIN-ów z `amazon/ads/scrap`. |
| `ads` | `outcome`: `prices` / `empty` / `deleted` | ASIN rozstrzygnięty: wysłane ceny / brak cen w żadnym kraju / usunięty. |
| `ad_duration_ms` | – | Suma czasu od startu do rozstrzygnięcia ASIN-a. Średnia = `ad_duration_ms / ads`. |
| `ads_in_flight` | – (gauge) | ASIN-y w trakcie przetwarzania. |

## PLP

| Metryka | Labels | Co opisuje |
|---|---|---|
| `new_releases_pages` | `country=pl`, `outcome`: `data` / `given_up` | Strony nowości: pobrane / porzucone. |
| `new_releases_ads` | `country=pl` | Nowe (pierwszy raz w przebiegu kategorii) ASIN-y z nowości. |

## Wysyłka do backendu (`BatchSender`)

| Metryka | Labels | Co opisuje |
|---|---|---|
| `backend_requests` | `outcome`: `ok` / `timeout` / `network` / `http_<status>` | Każda próba POST batcha (także retry). |
| `backend_send_ms` | – | Suma czasu prób. |
| `backend_items` | `outcome`: `sent` / `dropped` | Pozycje wysłane / porzucone (4xx lub 6 prób). |
| `backend_buffer` | – (gauge) | Pozycje czekające w buforze (jeden `BatchSender` na tryb: PDP `amazon/ads/batch`, PLP `amazon/ads`). |

## Proces (dodawane przez `MetricsReporter`, chwila raportu)

| Metryka | Co opisuje |
|---|---|
| `pending` | Requesty w toku w `TokenBucketQueue`. |
| `queue_length` | Requesty czekające w kolejce. |
| `open_connections` | Otwarte połączenia proxy. |
| `event_loop_delay_mean_ms` / `event_loop_delay_max_ms` | Opóźnienie event loop w minucie (minus 10 ms rozdzielczości). |
| `cpu_percent` | % jednego rdzenia od poprzedniego raportu. |
| `memory_rss_mb` / `heap_used_mb` | Pamięć procesu. |
| `ping_ms` / `ping_failed` | TCP ping do `1.1.1.1:443` (timeout 2 s); jedna z dwóch. |

## Dodanie metryki

1. `increment` / `gauge` w kodzie, labels tylko `country` i `outcome`.
2. Nowy outcome → typ w `src/shared/metrics/metrics.types.ts`.
3. Test w `tests/unit/...` dla pliku źródłowego.
4. Backend: czy raport godzinowy ma ją pokazać (`amazon-server`, `src/modules/monitoring/`).
5. Ten plik + `docs/superpowers/specs/2026-10-18-scraper-metrics-design.md`.
