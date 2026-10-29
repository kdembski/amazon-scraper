import _ from "lodash";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { cronJobs } from "@@tests/support/cron";
import { newReleasesPage, plpPage } from "@@tests/support/html";
import {
  bootScraper,
  sleep,
  startWorld,
  stopWorld,
  World,
} from "@@tests/support/integration";

const PRICE_RANGES = 19;

// Price range and page number of a requested listing
const parse = (url: string) => ({
  price: url.match(/p_36%3A([\d-]+)/)?.[1],
  number: Number(url.match(/&page=(\d+)/)?.[1] ?? 1),
});

const ad = (asin: string) => ({
  asin,
  name: `Product ${asin}`,
  image: `https://m.media-amazon.com/images/I/${asin}.jpg`,
  categoryName: "electronics",
});

const category = (scrapedAt: string | null = null) => ({
  id: 1,
  name: "electronics",
  scrapedAt,
});

describe("PLP", () => {
  let world: World;

  // The category is scraped once, asking for the next one fails
  const serveCategory = (scrapedAt: string | null = null) =>
    world.backend.onSequence("GET", "amazon/ads/categories/scrap", [
      { body: category(scrapedAt) },
      { status: 500 },
    ]);

  beforeEach(async () => {
    world = await startWorld();
    world.backend.on("GET", "scrapers/it/config", { concurrency: 10, rps: 0, batchSize: 100 });
    serveCategory();
  });

  afterEach(() => stopWorld(world));

  const scrape = async () => (await bootScraper(["-t", "plp"])).scraper.execute();

  const isNewReleases = (url: string) => url.startsWith("pl/gp/new-releases/");

  // Answers the search listings, the new releases ranking is empty
  const respondSearch = (responder: Parameters<World["amazon"]["respond"]>[0]) =>
    world.amazon.respond((request) =>
      isNewReleases(request.url) ? newReleasesPage() : responder(request)
    );

  const searches = () =>
    world.amazon.requests.filter(({ url }) => !isNewReleases(url));

  const posted = () =>
    world.backend.find("POST", "amazon/ads").flatMap((post) => post.body);

  const waitForAds = async (count: number) => {
    await world.backend.waitFor("POST", "amazon/ads");
    await expect.poll(() => posted().length).toBe(count);
    return posted();
  };

  it("sends the newest ads of every price range", async () => {
    respondSearch(({ url }) => plpPage({ asins: [`B0${parse(url).price}`] }));
    scrape();

    const posts = await waitForAds(PRICE_RANGES);
    await sleep(200);

    expect(posts).toContainEqual(ad("B0-999"));
    expect(posts).toContainEqual(ad("B0500000-"));
    const requests = searches().map(({ url }) => parse(url));
    expect(requests).toHaveLength(PRICE_RANGES);
    expect(_.uniqWith(requests, _.isEqual)).toHaveLength(PRICE_RANGES);
    expect(searches()[0].url).toMatch(/^pl\/s\?i=electronics&rh=p_36%3A[\d-]+&s=date-desc-rank$/);
    expect(searches()[0].headers.referer).toMatch(
      /^https:\/\/www\.amazon\.pl\/b\?node=\d+$/
    );
  });

  it("splits a price range with 400 pages in half", async () => {
    respondSearch(({ url }) => {
      const { price } = parse(url);
      return plpPage({ asins: [`B0${price}`], lastPage: price === "-999" ? 400 : 1 });
    });
    scrape();

    await waitForAds(PRICE_RANGES + 2);
    await sleep(200);

    const prices = searches().map(({ url }) => parse(url).price);
    expect(prices).toContain("-499");
    expect(prices).toContain("500-999");
    expect(prices).toHaveLength(PRICE_RANGES + 2);
    expect(posted()).toContainEqual(ad("B0-499"));
    expect(posted()).toContainEqual(ad("B0500-999"));
  });

  const paginated = () =>
    respondSearch(({ url }) => {
      const { price, number } = parse(url);
      return plpPage({ asins: [`B0${price}P${number}`], lastPage: 3 });
    });

  it("follows the pagination to the last page in every price range of a category never scraped", async () => {
    paginated();
    scrape();

    const posts = await waitForAds(3 * PRICE_RANGES);
    await sleep(200);

    expect(_.uniq(posts.map((ad) => ad.asin))).toHaveLength(3 * PRICE_RANGES);
    expect(searches()).toHaveLength(3 * PRICE_RANGES);
  });

  it("scrapes only the first page in every price range of a category scraped before", async () => {
    serveCategory("2026-10-18T10:00:00.000Z");
    paginated();
    scrape();

    await waitForAds(PRICE_RANGES);
    await sleep(200);

    expect(searches()).toHaveLength(PRICE_RANGES);
    expect(searches().every(({ url }) => parse(url).number === 1)).toBe(true);
  });

  it("does not retry an empty price range", async () => {
    respondSearch(() => plpPage({ empty: true }));
    scrape();

    await expect.poll(() => searches().length).toBe(PRICE_RANGES);
    await sleep(200);

    expect(searches()).toHaveLength(PRICE_RANGES);
    expect(world.backend.find("POST", "amazon/ads")).toHaveLength(0);
  });

  it("retries a listing without ads", async () => {
    let attempts = 0;
    respondSearch(({ url }) =>
      attempts++ === 0 ? plpPage() : plpPage({ asins: [`B0${parse(url).price}`] })
    );
    scrape();

    await waitForAds(PRICE_RANGES);

    expect(searches()).toHaveLength(PRICE_RANGES + 1);
  });

  it("gives up on a listing after the attempt limit", async () => {
    respondSearch(() => ({ status: 503 }));
    scrape();

    await expect
      .poll(() => searches().length)
      .toBe(MAX_FAILED_ATTEMPTS * PRICE_RANGES);
    await sleep(200);

    expect(searches()).toHaveLength(MAX_FAILED_ATTEMPTS * PRICE_RANGES);
    expect(world.backend.find("POST", "amazon/ads")).toHaveLength(0);
  });

  it("sends the new releases of the category tree before searching the listings", async () => {
    const pages: Record<string, string> = {
      "pl/gp/new-releases/electronics": newReleasesPage({ asins: ["B0NEW1"], nodes: ["7"], next: true }),
      "pl/gp/new-releases/electronics?pg=2": newReleasesPage({ asins: ["B0NEW2"] }),
      "pl/gp/new-releases/electronics/7": newReleasesPage({ asins: ["B0NEW1", "B0NEW7"], nodes: ["7"] }),
    };
    world.amazon.respond(({ url }) => pages[url] ?? plpPage({ empty: true }));
    scrape();

    await expect.poll(() => searches().length).toBeGreaterThan(0);

    const newReleases = world.amazon.requests.filter(({ url }) => isNewReleases(url));
    expect(newReleases.map(({ url }) => url).sort()).toEqual(Object.keys(pages).sort());
    expect(_.last(newReleases)!.at).toBeLessThanOrEqual(searches()[0].at);
    expect(posted().map((ad: { asin: string }) => ad.asin).sort()).toEqual(["B0NEW1", "B0NEW2", "B0NEW7"]);
    expect(posted()[0]).toEqual({
      asin: "B0NEW1",
      name: "Product B0NEW1",
      image: "https://images-eu.ssl-images-amazon.com/images/I/B0NEW1.jpg",
      categoryName: "electronics",
    });
  });

  it("sends an ASIN found in the new releases or another price range only once", async () => {
    world.amazon.respond(({ url }) =>
      isNewReleases(url)
        ? newReleasesPage({ asins: ["B0SAME"] })
        : plpPage({ asins: ["B0SAME", "B0LIST"] })
    );
    scrape();

    await expect.poll(() => searches().length).toBe(PRICE_RANGES);
    await sleep(200);

    expect(posted().map((ad: { asin: string }) => ad.asin).sort()).toEqual(["B0LIST", "B0SAME"]);
  });

  it("scrapes the next category once the previous one is done", async () => {
    world.backend.onSequence("GET", "amazon/ads/categories/scrap", [
      { body: category() },
      { body: { id: 2, name: "toys", scrapedAt: null } },
      { status: 500 },
    ]);
    respondSearch(() => plpPage({ empty: true }));
    scrape();

    await expect.poll(() => searches().length).toBe(2 * PRICE_RANGES);
    await sleep(200);

    const toys = searches().filter(({ url }) => url.includes("i=toys"));
    const electronics = searches().filter(({ url }) => url.includes("i=electronics"));
    expect(toys).toHaveLength(PRICE_RANGES);
    expect(_.max(electronics.map(({ at }) => at))).toBeLessThanOrEqual(_.min(toys.map(({ at }) => at))!);
    expect(world.backend.find("GET", "amazon/ads/categories/scrap")).toHaveLength(3);
  });

  it("reports metrics every minute", async () => {
    respondSearch(({ url }) => plpPage({ asins: [`B0${parse(url).price}`] }));
    scrape();
    await waitForAds(PRICE_RANGES);

    cronJobs
      .filter((job) => job.cronTime === "0 * * * * *")
      .forEach((job) => job.onTick());

    const post = await world.backend.waitFor("POST", "scrapers/it/metrics");
    expect(post.body).toMatchObject({ marketplace: "amazon", flow: "plp" });
    const items = post.body.metrics.find(
      (m: any) => m.metric === "items" && m.country === "pl" && m.outcome === "data"
    );
    expect(items.value).toBeGreaterThanOrEqual(1);
  });
});
