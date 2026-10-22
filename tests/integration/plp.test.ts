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

// Subcategory, price range and page number of a requested listing
const parse = (url: string) => ({
  node: url.match(/rh=n%3A(\d+)/)?.[1] ?? "root",
  price: url.match(/p_36%3A([\d-]+)/)?.[1],
  number: Number(url.match(/&page=(\d+)/)?.[1] ?? 1),
});

const ad = (asin: string) => ({
  asin,
  name: `Product ${asin}`,
  image: `https://m.media-amazon.com/images/I/${asin}.jpg`,
  categoryName: "electronics",
});

describe("PLP", () => {
  let world: World;

  beforeEach(async () => {
    world = await startWorld();
    world.backend.on("GET", "amazon/ads/categories/scrap", {
      id: 1,
      name: "electronics",
      scrapedAt: null,
    });
  });

  afterEach(() => stopWorld(world));

  const scrape = () => bootScraper(["-t", "plp", "-c", "100"]).scraper.execute();

  const isNewReleases = (url: string) => url.startsWith("pl/gp/new-releases/");

  // Answers the search listings, the new releases ranking is empty
  const respondSearch = (responder: Parameters<World["amazon"]["respond"]>[0]) =>
    world.amazon.respond((request) =>
      isNewReleases(request.url) ? newReleasesPage() : responder(request)
    );

  const searches = () =>
    world.amazon.requests.filter(({ url }) => !isNewReleases(url));

  const waitForPosts = async (count: number) => {
    await world.backend.waitFor("POST", "amazon/ads");
    await expect
      .poll(() => world.backend.find("POST", "amazon/ads").length)
      .toBe(count);
    return world.backend.find("POST", "amazon/ads").map((post) => post.body);
  };

  it("sends the newest ads of the category and its subcategories in every price range", async () => {
    const pages: Record<string, string> = {
      root: plpPage({
        asins: ["B0ROOT1", "B0ROOT2"],
        path: ["n/10"],
        subcategories: ["n/11", "n/12"],
      }),
      "11": plpPage({
        asins: ["B0SUB11"],
        path: ["n/10", "n/11"],
        subcategories: ["n/12"],
      }),
      "12": plpPage({ asins: ["B0SUB12"], path: ["n/10", "n/12"] }),
    };
    respondSearch(({ url }) => pages[parse(url).node] ?? { status: 404 });
    scrape();

    const posts = await waitForPosts(3 * PRICE_RANGES);
    await sleep(200);

    expect(posts).toContainEqual([ad("B0ROOT1"), ad("B0ROOT2")]);
    expect(posts).toContainEqual([ad("B0SUB11")]);
    expect(posts).toContainEqual([ad("B0SUB12")]);
    const requests = searches().map(({ url }) => parse(url));
    expect(requests).toHaveLength(3 * PRICE_RANGES);
    expect(_.uniqWith(requests, _.isEqual)).toHaveLength(3 * PRICE_RANGES);
    expect(requests.every((request) => request.price)).toBe(true);
    expect(searches()[0].headers.referer).toMatch(
      /^https:\/\/www\.amazon\.pl\/b\?node=\d+$/
    );
  });

  const paginated = () =>
    respondSearch(({ url }) => {
      const { price, number } = parse(url);
      return plpPage({ asins: [`B0${price}P${number}`], next: number < 3 });
    });

  it("follows the pagination to the last page in every price range of a category never scraped", async () => {
    paginated();
    scrape();

    const posts = await waitForPosts(3 * PRICE_RANGES);
    await sleep(200);

    expect(_.uniq(posts.flat().map((ad) => ad.asin))).toHaveLength(
      3 * PRICE_RANGES
    );
    expect(searches()).toHaveLength(3 * PRICE_RANGES);
  });

  it("scrapes only the first page in every price range of a category scraped before", async () => {
    world.backend.on("GET", "amazon/ads/categories/scrap", {
      id: 1,
      name: "electronics",
      scrapedAt: "2026-10-18T10:00:00.000Z",
    });
    paginated();
    scrape();

    await waitForPosts(PRICE_RANGES);
    await sleep(200);

    expect(searches()).toHaveLength(PRICE_RANGES);
    expect(searches().every(({ url }) => parse(url).number === 1)).toBe(true);
  });

  it("retries a listing without ads", async () => {
    let attempts = 0;
    respondSearch(() =>
      attempts++ === 0 ? plpPage() : plpPage({ asins: ["B0ROOT1"] })
    );
    scrape();

    const posts = await waitForPosts(PRICE_RANGES);

    expect(posts).toEqual(_.times(PRICE_RANGES, () => [ad("B0ROOT1")]));
    expect(searches()).toHaveLength(PRICE_RANGES + 1);
  });

  it("gives up on a listing after the attempt limit", async () => {
    respondSearch(() => ({ status: 503 }));
    scrape();

    await expect
      .poll(() => searches().length)
      .toBe(MAX_FAILED_ATTEMPTS * PRICE_RANGES);
    await sleep(200);

    expect(searches()).toHaveLength(
      MAX_FAILED_ATTEMPTS * PRICE_RANGES
    );
    expect(world.backend.find("POST", "amazon/ads")).toHaveLength(0);
  });

  it("sends the new releases of the category tree before searching the listings", async () => {
    const pages: Record<string, string> = {
      "pl/gp/new-releases/electronics": newReleasesPage({ asins: ["B0NEW1"], nodes: ["7"], next: true }),
      "pl/gp/new-releases/electronics?pg=2": newReleasesPage({ asins: ["B0NEW2"] }),
      "pl/gp/new-releases/electronics/7": newReleasesPage({ asins: ["B0NEW1", "B0NEW7"], nodes: ["7"] }),
    };
    world.amazon.respond(({ url }) => pages[url] ?? plpPage());
    scrape();

    await expect.poll(() => searches().length).toBeGreaterThan(0);

    const newReleases = world.amazon.requests.filter(({ url }) => isNewReleases(url));
    expect(newReleases.map(({ url }) => url).sort()).toEqual(Object.keys(pages).sort());
    expect(_.last(newReleases)!.at).toBeLessThanOrEqual(searches()[0].at);
    const posted = world.backend.find("POST", "amazon/ads").flatMap((post) => post.body);
    expect(posted.map((ad: { asin: string }) => ad.asin).sort()).toEqual(["B0NEW1", "B0NEW2", "B0NEW7"]);
    expect(posted[0]).toEqual({
      asin: "B0NEW1",
      name: "Product B0NEW1",
      image: "https://images-eu.ssl-images-amazon.com/images/I/B0NEW1.jpg",
      categoryName: "electronics",
    });
  });

  it("reports metrics every minute", async () => {
    respondSearch(() => plpPage({ asins: ["B0ROOT1"] }));
    scrape();
    await waitForPosts(PRICE_RANGES);

    const report = cronJobs.find((job) => job.cronTime === "0 * * * * *");
    report!.onTick();

    const post = await world.backend.waitFor("POST", "scrapers/it/metrics");
    expect(post.body).toMatchObject({ marketplace: "amazon", flow: "plp" });
    const items = post.body.metrics.find(
      (m: any) => m.metric === "items" && m.country === "pl" && m.outcome === "data"
    );
    expect(items.value).toBeGreaterThanOrEqual(1);
  });
});
