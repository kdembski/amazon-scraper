# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Czym jest ten projekt

Worker w Node.js/TypeScript (ESM), który scrapuje Amazona przez rotowane proxy. Nie ma własnej bazy ani trwałego stanu: listę pracy pobiera z zewnętrznego backendu (`API_URL`) i tam odsyła wyniki. Ma dwa tryby:

- **PDP** (domyślny): dla partii produktów (ASIN) z backendu pobiera cenę i sprzedawcę/wysyłkę we wszystkich krajach zwróconych przez backend. Domyślnie z fragmentu AJAX „All Offers Display” (`amazon.<kod>/gp/product/ajax/aodAjaxMain/?asin=<asin>&pc=dp`, ~9 KB), a z flagą `-s pdp` z pełnej strony `amazon.<kod>/dp/<asin>` (~300–400 KB).
- **PLP**: przechodzi listingi kategorii na `amazon.pl` (na sztywno), posortowane od najnowszych, rekurencyjnie wchodzi w podkategorie i wysyła znalezione produkty do backendu. Bierze tylko pierwszą stronę wyników, bez paginacji.

Repo nie ma README, lintera, testów jednostkowych ani CI.

## Komendy

```bash
npm start                              # tsx ./src/index.ts, tryb PDP z domyślnymi flagami
npm start -- -t plp -c 1000 -l 500     # z flagami CLI
npm run build                          # pkgroll → dist/ (z tego startuje PM2)
npx tsc --noEmit                       # sprawdzenie typów (nie ma osobnego skryptu)
npm test -- <ASIN> [-s pdp]            # ręczny smoke test, opis niżej
pm2 start ecosystem.config.cjs         # produkcja: 6× PDP + 1× PLP na dist/index.js
```

`npm test` nie uruchamia testów jednostkowych. `src/test.ts` pobiera jeden ASIN z 5 krajów (de, fr, it, pl, se) przez prawdziwe proxy ze źródła wybranego flagą `-s`, zapisuje HTML do `test-html/<asin>-<kraj>-<aod|pdp>.html` i wypisuje wynik buildera. Wymaga `.env` i istniejącego katalogu `test-html/` (jest w `.gitignore`). Proces nie kończy się sam, bo singletony uruchamiają timery i crony, więc trzeba go przerwać ręcznie. Zapisane pliki HTML służą do debugowania selektorów w builderach.

## Konfiguracja

Zmienne środowiskowe (`.env` ładowany przez `dotenv`; w repo nie ma `.env.example`):
- `API_URL`: bazowy URL backendu.
- `PROXY_LIST_TOKEN`: token do listy proxy webshare.io (linie w formacie `host:port:user:pass`).
- `name`: **ustawia go PM2** (nazwa aplikacji z `ecosystem.config.cjs`, np. `pdp-3`). Trafia do endpointów `scrapers/<name>/...`, z których korzystają regulator i raport statusu. Przy lokalnym `npm start` ma wartość `undefined`.

Flagi CLI (`ArgsService`):
- `-t/--target pdp|plp`: tryb (domyślnie `pdp`).
- `-l/--limit`: startowy limit współbieżnych requestów do Amazona (domyślnie 10). W PDP regulator zmienia go w trakcie działania.
- `-s/--source aod|pdp`: źródło danych w trybie PDP (domyślnie `aod`, opis w „Parsowanie HTML”). `pdp` służy jako rollback.
- `-c/--count` (domyślnie 50): w PDP wielkość partii ASIN-ów pobieranej z backendu, w PLP długość kolejki, powyżej której nowe strony nie są dodawane.

`src/index.ts` ustawia globalnie `NODE_TLS_REJECT_UNAUTHORIZED=0`. Handlery `uncaughtException`/`unhandledRejection` tylko logują, więc proces nie kończy działania i PM2 go nie restartuje.

## Architektura

### Ścieżka każdego requestu do Amazona

`scraper → AmazonService.get(url, referer, { onSuccess, onError, onFinally }) → RequestQueueService`

- `AmazonService` (singleton) jest jedynym miejscem, które odpytuje Amazona. `url` jest doklejany do `https://www.amazon.`, więc zaczyna się od kodu kraju/TLD (`de/dp/...`, `pl/s?...`). Każdy request dostaje losowe proxy z `ProxyService`, losowy User-Agent i nowy `HttpsProxyAgent`. API opiera się na callbackach: `get()` niczego nie zwraca, a wynik trafia wyłącznie do callbacków.
- `RequestQueueService` to własny limiter współbieżności. `request()` wykonuje zadanie od razu, jeśli `pending < limit`, a w przeciwnym razie dodaje je do `queue`. Pętla `start()` co 1 ms pobiera do 10 zadań z kolejki. Co sekundę loguje statystyki do stdout. Liczniki `completed`/`failed` zwiększają **scrapery**, a nie kolejka, i są zerowane przy pobraniu każdej nowej partii.
- `RequestQueueRegulator` działa tylko w trybie PDP. Co 20 minut koryguje `limit` na podstawie metryk CPU/RAM, które **pobiera z backendu** (`system/cpu`, `system/mem`, `scrapers/<name>/cpu`, `scrapers/count`) zamiast mierzyć lokalnie. Docelowe CPU maszyny (`targetedGlobalCpu`, które dąży do 80%) dzieli przez liczbę scraperów i zmienia limit proporcjonalnie do odchyłki (krok 500, minimum 100). Gdy zużycie pamięci przekracza 85%, pomija korektę. Parametry regulacji są często strojone, co widać w historii gita.

### Tryb PDP

Co 5 sekund `AmazonScraper.scrapPdp()` sprawdza kolejkę. Jeśli jest krótsza niż `count/10`, pobiera `GET amazon/ads/scrap?count=<count>` i dla każdego ogłoszenia wywołuje `AmazonPdpScraper.execute(ad, countries)`.

Dla każdego ogłoszenia powstaje tablica obiektów `AmazonAdPrice`, po jednym na kraj. Działają one jak ręczna maszyna stanów (`pending`, `complete`, `deleted`, `adDeleted`, `failed`), a funkcje `resolve`/`reject` promise'a są zapisane na samym obiekcie. Logika jest rozłożona na trzy miejsca: `RequestAmazonPdpCountryScraper` (request i obsługa odpowiedzi), abstrakcyjną klasę bazową `scrapers/abstract/AmazonPdpCountryScraper` (retry, complete, delete) oraz `AmazonPdpPriceHelper`. Przebieg wygląda tak:
- Sukces: cena i `dispatchFrom` pochodzą z buildera wybranego flagą `-s` (`AmazonAodAdBuilder` albo `AmazonPdpAdBuilder`, wspólny interfejs `AmazonAdBuilder`). Captcha, pusta odpowiedź lub odpowiedź niebędąca fragmentem AOD (`isValid: false`, np. bot challenge) powoduje reject i retry, czyli ponowne dodanie na koniec kolejki.
- Błąd sieci: retry. Po ponad 200 porażkach kraj zostaje zakończony bez ceny.
- 404: kraj zostaje oznaczony jako usunięty. Gdy nieusunięte zostają najwyżej 2 kraje, całe ogłoszenie jest usuwane przez `DELETE amazon/ads/<id>`.
- Gdy wszystkie kraje mają `complete`, wyniki trafiają do `PUT amazon/ads/<id>` z treścią `{ prices: [{ adId, countryId, value, dispatchFrom }] }`.

Abstrakcja `AmazonPdpCountryScraper` pozostała po usuniętej implementacji headless (Playwright, commit `418cabd`). Obecnie istnieje tylko implementacja oparta na requestach.

Co godzinę (w 50. minucie) `AmazonService` wysyła `POST scrapers/<name>/status` z polami `speed` i `pending`.

### Tryb PLP

Przy starcie i potem co godzinę `GET amazon/ads/categories/scrap` zwraca jedną kategorię. `AmazonPlpPageScraper` pobiera wtedy `pl/s?i=<kategoria>[&rh=<podkategoria>]&s=date-desc-rank`, a `AmazonPlpBuilder` wyciąga z niej produkty (`div[role='listitem']`) i ID podkategorii (`ul#filter-n li[id]`). Produkty trafiają do `POST amazon/ads`, a każda podkategoria jest scrapowana rekurencyjnie tym samym sposobem.

### Parsowanie HTML

Buildery w `src/builders/` dostają `Document` z `linkedom` (`parseHTML`) i opierają się na selektorach DOM Amazona. To najbardziej kruche miejsce projektu: zmiana layoutu Amazona psuje je bez żadnego błędu. `AmazonPdpAdPriceBuilder` zbiera cenę z kilku alternatywnych kontenerów i selektorów, a następnie wybiera wartość, która występuje najczęściej. `cleanUpPrice` zakłada **przecinek jako separator dziesiętny** (format rynków UE). Cena zapisana jako `12.99` albo z przecinkiem jako separatorem tysięcy zostanie sparsowana błędnie. Captchę rozpoznaje po `form[action="/errors/validateCaptcha"]`.

`AmazonAodAdBuilder` czyta tylko przypiętą ofertę (`#aod-pinned-offer`), czyli tę samą ofertę co buybox na PDP. Brak `[id^=aod-price-]` w przypiętej ofercie oznacza brak polecanej oferty, a wtedy kraj kończy się bez ceny. `.a-offscreen` jest tu zwykle pusty, więc cena pochodzi z `.a-price-whole` + `.a-price-fraction`. Na części rynków (np. nl) wysyłka ma wartość `Amazon.nl`, którą builder normalizuje do `Amazon`, bo backend porównuje `dispatchFrom === "Amazon"`. Różnice względem PDP: (1) PDP dla wariantu bez oferty po cichu pokazuje buybox innego wariantu, a AOD zwraca brak oferty; (2) PDP na `amazon.de` przy IP spoza strefy euro przelicza ceny na walutę lokalizacji (`currencyOfPreference`), a AOD zawsze zwraca walutę rynku.

### Backend API

`ApiService` jest singletonem, a wszystkie ścieżki są względne względem `API_URL`. `get()` przy błędzie rzuca wyjątek, natomiast `post`/`put`/`delete` go przechwytują i tylko logują. `countries` i `amazon/ads/categories` są cache'owane i odświeżane co godzinę cronem.

## Konwencje

- Importy zawsze przez alias `@/` (wskazuje na `src/`, zdefiniowany w `tsconfig.json`).
- Współdzielone serwisy to singletony z prywatnym konstruktorem i metodą `getInstance()` (`ApiService`, `AmazonService`, `ArgsService`, `ProxyService`). Pozostałe klasy przyjmują zależności jako parametry konstruktora z wartościami domyślnymi, np. `apiService = ApiService.getInstance()` albo `builder = new AmazonPdpAdBuilder()`. Nowe klasy powinny trzymać się tego wzorca.
- Zadania okresowe realizuje `CronJob` z pakietu `cron` (wyrażenia z polem sekund) albo `setInterval`.
- Komentarze w kodzie piszemy wyłącznie po angielsku.
- Repo nie ma konfiguracji prettiera ani eslinta. Obowiązujący styl: 2 spacje, podwójne cudzysłowy, średniki, `lodash` importowany jako `_`.
- `WebSocketService` (a z nim zależność `ws`) oraz typy `AmazonPdpAd` i `AmazonPlpAdPageSort` nie są obecnie nigdzie używane.
