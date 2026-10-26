import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import type { AmazonPlpPageFetcher } from "@/marketplaces/amazon/plp/AmazonPlpPageFetcher";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { fakeApiService } from "@@tests/support/fakes";

type Reply = { lastPage?: number; asins?: string[]; failed?: number; givenUp?: boolean };

const ad = (asin: string) => ({ asin, name: asin, image: `${asin}.jpg`, categoryName: "electronics" });

// Price filter and page number of a requested listing
const parse = (url: string) => ({
  price: url.match(/p_36%3A([\d-]+)/)![1],
  number: Number(url.match(/&page=(\d+)/)?.[1] ?? 1),
});

const setup = (reply: (price: string, number: number) => Reply = () => ({}), allPages = false) => {
  const api = fakeApiService();
  const fetch = vi.fn(async (url: string, _referer: string) => {
    const { price, number } = parse(url);
    const { lastPage = 1, asins = [`B0${price}P${number}`], failed = 0, givenUp } = reply(price, number);
    if (givenUp) return { failed: MAX_FAILED_ATTEMPTS };
    return { page: { isValid: true, ads: asins.map(ad), lastPage }, failed };
  });
  const increment = vi.fn();
  const scraper = new AmazonPlpPageScraper(
    { fetch } as unknown as AmazonPlpPageFetcher,
    undefined,
    { increment } as unknown as MetricsService
  );
  const crawl = new AmazonPlpCrawl("electronics", allPages, api.service);
  const requests = () => fetch.mock.calls.map(([url]) => parse(url));
  return { api, fetch, increment, scraper, crawl, requests };
};

const seeds = [
  "-999",
  "1000-1999",
  "2000-2999",
  "3000-3999",
  "4000-4999",
  "5000-7499",
  "7500-9999",
  "10000-14999",
  "15000-19999",
  "20000-29999",
  "30000-39999",
  "40000-49999",
  "50000-74999",
  "75000-99999",
  "100000-149999",
  "150000-199999",
  "200000-299999",
  "300000-499999",
  "500000-",
];

describe("AmazonPlpPageScraper", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrapes the first page of every seed price range", async () => {
    const { fetch, scraper, crawl } = setup();

    await scraper.execute(crawl);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      seeds.map((price) => `pl/s?i=electronics&rh=p_36%3A${price}&s=date-desc-rank`)
    );
    expect(fetch.mock.calls[0][1]).toBe("pl/b?node=50000000000");
  });

  it.each([false, true])(
    "splits a range with 400 pages and skips its further pages (allPages %s)",
    async (allPages) => {
      const { requests, scraper, crawl } = setup(
        (price) => ({ lastPage: price === "-999" ? 400 : 1 }),
        allPages
      );

      await scraper.execute(crawl);

      expect(requests()).toContainEqual({ price: "-499", number: 1 });
      expect(requests()).toContainEqual({ price: "500-999", number: 1 });
      expect(requests().filter(({ number }) => number > 1)).toEqual([]);
      expect(requests()).toHaveLength(seeds.length + 2);
    }
  );

  it("splits the open range at double its minimum", async () => {
    const { requests, scraper, crawl } = setup((price) => ({
      lastPage: price === "500000-" ? 400 : 1,
    }));

    await scraper.execute(crawl);

    expect(requests()).toContainEqual({ price: "500000-999999", number: 1 });
    expect(requests()).toContainEqual({ price: "1000000-", number: 1 });
  });

  it("follows the pagination of a range below 400 pages when scraping all pages", async () => {
    const { requests, scraper, crawl } = setup(
      (price) => ({ lastPage: price === "-999" ? 3 : 1 }),
      true
    );

    await scraper.execute(crawl);

    expect(requests().filter(({ price }) => price === "-999")).toEqual([
      { price: "-999", number: 1 },
      { price: "-999", number: 2 },
      { price: "-999", number: 3 },
    ]);
  });

  it("scrapes only the first page when not scraping all pages", async () => {
    const { requests, scraper, crawl } = setup(() => ({ lastPage: 3 }));

    await scraper.execute(crawl);

    expect(requests().every(({ number }) => number === 1)).toBe(true);
  });

  it("paginates a single grosz range with 400 pages instead of splitting it", async () => {
    const { requests, scraper, crawl } = setup(
      (price) => ({ lastPage: price.startsWith("-") ? 400 : 1 }),
      true
    );

    await scraper.execute(crawl);

    const single = requests().filter(({ price }) => price === "-0");
    expect(single).toHaveLength(400);
    expect(single.at(-1)).toEqual({ price: "-0", number: 400 });
    expect(requests().filter(({ price }) => price.startsWith("-") && price !== "-0")
      .every(({ number }) => number === 1)).toBe(true);
  });

  it("stops paginating a range after a given up page", async () => {
    const { requests, increment, scraper, crawl } = setup(
      (price, number) => ({
        lastPage: price === "-999" ? 3 : 1,
        givenUp: price === "-999" && number === 2,
      }),
      true
    );

    await scraper.execute(crawl);

    expect(requests()).not.toContainEqual({ price: "-999", number: 3 });
    expect(increment).toHaveBeenCalledWith("items", { country: "pl", outcome: "given_up" });
    expect(increment).toHaveBeenCalledWith(
      "item_attempts",
      { country: "pl", outcome: "given_up" },
      MAX_FAILED_ATTEMPTS
    );
  });

  it("counts a page with products as data and an empty one as no_data", async () => {
    const { increment, scraper, crawl } = setup((price) => ({
      asins: price === "-999" ? [] : undefined,
      failed: price === "1000-1999" ? 2 : 0,
    }));

    await scraper.execute(crawl);

    expect(increment).toHaveBeenCalledWith("items", { country: "pl", outcome: "no_data" });
    expect(increment).toHaveBeenCalledWith("item_attempts", { country: "pl", outcome: "data" }, 3);
    expect(increment.mock.calls.filter(([metric]) => metric === "items")).toHaveLength(seeds.length);
  });

  it("sends the ads of every page through the crawl", async () => {
    const { api, scraper, crawl } = setup(() => ({ asins: ["B0SAME"] }));

    await scraper.execute(crawl);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("amazon/ads", [ad("B0SAME")]);
  });
});
