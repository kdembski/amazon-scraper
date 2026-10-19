import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import type { AmazonPlpBuilder } from "@/marketplaces/amazon/plp/AmazonPlpBuilder";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { buildPlpPage } from "@@tests/support/factories";
import {
  fakeAmazonService,
  fakeApiService,
  fakeArgsService,
} from "@@tests/support/fakes";

const html = "<html><body></body></html>";
const ads: AmazonPlpAd[] = [
  { asin: "B0TESTASIN", name: "Test", image: "img", categoryName: "electronics" },
];

const setup = ({ count = 50 } = {}) => {
  const amazon = fakeAmazonService();
  const api = fakeApiService();
  const args = fakeArgsService({ count });
  const build = vi.fn(() => ({
    ads,
    subcategories: [] as string[],
    hasNextPage: false,
  }));
  const increment = vi.fn();
  const builder = { build } as unknown as AmazonPlpBuilder;
  const scraper = new AmazonPlpPageScraper(
    api.service,
    amazon.service,
    args.service,
    builder,
    { increment } as unknown as MetricsService
  );
  return { amazon, api, build, scraper, increment };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

const priceRanges = [
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
const inPriceRanges = (subcategory?: string) =>
  priceRanges.map(
    (price) =>
      `pl/s?i=electronics&rh=${
        subcategory ? `${subcategory}%2C` : ""
      }p_36%3A${price}&s=date-desc-rank`
  );

describe("AmazonPlpPageScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("buildPage", () => {
    it("builds a fresh page", () => {
      const { scraper } = setup();
      expect(scraper.buildPage("toys", false, "n%3A123")).toEqual({
        category: "toys",
        allPages: false,
        subcategory: "n%3A123",
        pending: false,
        complete: false,
        failed: 0,
        visited: new Set(),
        number: 1,
      });
    });

    it("shares the visited subcategories of the category", () => {
      const { scraper } = setup();
      const visited = new Set(["n%3A1"]);
      expect(scraper.buildPage("toys", false, "n%3A2", visited).visited).toBe(visited);
    });
  });

  describe("executeCategory", () => {
    it("scrapes the category in every price range", () => {
      const { amazon, scraper } = setup();
      scraper.executeCategory("electronics", false);

      expect(amazon.requests.map((request) => request.url)).toEqual(
        inPriceRanges()
      );
    });

    it("scrapes a subcategory in every price range", () => {
      const { amazon, scraper } = setup();
      scraper.executeCategory("electronics", false, "n%3A1");

      expect(amazon.requests.map((request) => request.url)).toEqual(
        inPriceRanges("n%3A1")
      );
    });
  });

  describe("execute", () => {
    it("requests the category listing sorted by newest", () => {
      const { amazon, scraper } = setup();
      const page = buildPlpPage();
      scraper.execute(page);

      expect(amazon.requests[0].url).toBe(
        "pl/s?i=electronics&s=date-desc-rank"
      );
      expect(amazon.requests[0].referer).toMatch(/^pl\/b\?node=\d+$/);
      expect(page.pending).toBe(true);
    });

    it("requests a subcategory listing", () => {
      const { amazon, scraper } = setup();
      scraper.execute(buildPlpPage({ subcategory: "n%3A123" }));

      expect(amazon.requests[0].url).toBe(
        "pl/s?i=electronics&rh=n%3A123&s=date-desc-rank"
      );
    });

    it("requests a further page of the listing", () => {
      const { amazon, scraper } = setup();
      scraper.execute(buildPlpPage({ subcategory: "n%3A123", number: 3 }));

      expect(amazon.requests[0].url).toBe(
        "pl/s?i=electronics&rh=n%3A123&s=date-desc-rank&page=3"
      );
    });

    it.each([
      [undefined, "pl/s?i=electronics&rh=p_36%3A2000-4999&s=date-desc-rank"],
      [
        "n%3A123",
        "pl/s?i=electronics&rh=n%3A123%2Cp_36%3A2000-4999&s=date-desc-rank",
      ],
    ])("requests a listing in a price range of %s", (subcategory, url) => {
      const { amazon, scraper } = setup();
      scraper.execute(buildPlpPage({ subcategory, price: "2000-4999" }));

      expect(amazon.requests[0].url).toBe(url);
    });

    it.each([["complete"], ["pending"]] as const)(
      "skips a page that is already %s",
      (state) => {
        const { amazon, scraper } = setup();
        scraper.execute(buildPlpPage({ [state]: true }));
        expect(amazon.get).not.toHaveBeenCalled();
      }
    );

    it("waits while the queue is full and requests the page once it drains", async () => {
      const { amazon, scraper } = setup({ count: 2 });
      amazon.queueService.queue.push(vi.fn(), vi.fn());
      const page = buildPlpPage();

      scraper.execute(page);
      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).not.toHaveBeenCalled();

      amazon.queueService.queue.length = 0;
      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(1);
      expect(page).toMatchObject({ pending: true, failed: 0 });
    });
  });

  describe("on success", () => {
    it("sends the ads and completes the page", async () => {
      const { amazon, api, build, scraper } = setup();
      const page = buildPlpPage();
      const done = scraper.execute(page);

      amazon.respond(0, html);
      await done;

      expect(build).toHaveBeenCalledWith(expect.anything(), "electronics");
      expect(api.post).toHaveBeenCalledWith("amazon/ads", ads);
      expect(page).toMatchObject({ pending: false, complete: true });
    });

    it("scrapes every subcategory in every price range", async () => {
      const { amazon, build, scraper } = setup();
      build.mockReturnValueOnce({ ads, subcategories: ["n%3A1", "n%3A2"], hasNextPage: false });
      scraper.execute(buildPlpPage());

      amazon.respond(0, html);
      await flush();

      expect(amazon.requests.map((request) => request.url)).toEqual([
        "pl/s?i=electronics&s=date-desc-rank",
        ...inPriceRanges("n%3A1"),
        ...inPriceRanges("n%3A2"),
      ]);
    });

    it("scrapes the next page in the same price range", async () => {
      const { amazon, build, scraper } = setup();
      build.mockReturnValueOnce({ ads, subcategories: [], hasNextPage: true });
      const page = buildPlpPage({
        allPages: true,
        subcategory: "n%3A1",
        price: "2000-4999",
      });
      scraper.execute(page);

      amazon.respond(0, html);
      await flush();

      expect(amazon.requests.map((request) => request.url)).toEqual([
        "pl/s?i=electronics&rh=n%3A1%2Cp_36%3A2000-4999&s=date-desc-rank",
        "pl/s?i=electronics&rh=n%3A1%2Cp_36%3A2000-4999&s=date-desc-rank&page=2",
      ]);
    });

    it("scrapes only the first page when not all pages are wanted", async () => {
      const { amazon, build, scraper } = setup();
      build.mockReturnValueOnce({ ads, subcategories: [], hasNextPage: true });
      scraper.execute(buildPlpPage());

      amazon.respond(0, html);
      await flush();

      expect(amazon.requests).toHaveLength(1);
    });

    it("passes all pages on to the subcategories", async () => {
      const { amazon, build, scraper } = setup();
      build
        .mockReturnValueOnce({ ads, subcategories: ["n%3A1"], hasNextPage: false })
        .mockReturnValueOnce({ ads, subcategories: [], hasNextPage: true });
      scraper.execute(buildPlpPage({ allPages: true }));

      amazon.respond(0, html);
      await flush();
      amazon.respond(1, html);
      await flush();

      expect(amazon.requests.at(-1)?.url).toBe(`${inPriceRanges("n%3A1")[0]}&page=2`);
    });

    it("stops when there is no next page", async () => {
      const { amazon, scraper } = setup();
      scraper.execute(buildPlpPage());

      amazon.respond(0, html);
      await flush();

      expect(amazon.requests).toHaveLength(1);
    });

    it("scrapes a subcategory only once", async () => {
      const { amazon, build, scraper } = setup();
      build
        .mockReturnValueOnce({ ads, subcategories: ["n%3A1", "n%3A2"], hasNextPage: false })
        .mockReturnValueOnce({ ads, subcategories: ["n%3A2", "n%3A3"], hasNextPage: false });
      scraper.execute(buildPlpPage());

      amazon.respond(0, html);
      await flush();
      amazon.respond(1, html);
      await flush();

      expect(amazon.requests.map((request) => request.url)).toEqual([
        "pl/s?i=electronics&s=date-desc-rank",
        ...inPriceRanges("n%3A1"),
        ...inPriceRanges("n%3A2"),
        ...inPriceRanges("n%3A3"),
      ]);
    });
  });

  describe("retries", () => {
    it.each([
      ["an empty response", (s: ReturnType<typeof setup>) => s.amazon.respond(0, "")],
      [
        "a page without ads",
        (s: ReturnType<typeof setup>) => {
          s.build.mockReturnValueOnce({ ads: [], subcategories: ["n%3A1"], hasNextPage: false });
          s.amazon.respond(0, html);
        },
      ],
      ["a network error", (s: ReturnType<typeof setup>) => s.amazon.fail(0)],
    ])("on %s", async (_name, answer) => {
      const s = setup();
      const page = buildPlpPage();
      s.scraper.execute(page);

      answer(s);
      await flush();

      expect(page).toMatchObject({ pending: false, complete: false, failed: 1 });
      expect(s.api.post).not.toHaveBeenCalled();
      expect(s.amazon.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(s.amazon.get).toHaveBeenCalledTimes(2);
      expect(s.amazon.requests[1].url).toBe(s.amazon.requests[0].url);
    });

    it("gives up on the page after the attempt limit", async () => {
      const { amazon, api, scraper } = setup();
      const page = buildPlpPage();
      scraper.execute(page);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        amazon.fail(amazon.requests.length - 1);
        await vi.runAllTimersAsync();
      }

      expect(page).toMatchObject({
        complete: true,
        failed: MAX_FAILED_ATTEMPTS,
      });
      expect(amazon.get).toHaveBeenCalledTimes(MAX_FAILED_ATTEMPTS);
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("metrics", () => {
    const labels = (outcome: string) => ({ country: "pl", outcome });

    it("counts a page with products as data", async () => {
      const { amazon, scraper, increment } = setup();
      const done = scraper.execute(buildPlpPage());

      amazon.respond(0, html);
      await done;

      expect(increment).toHaveBeenCalledWith("responses", labels("data"));
      expect(increment).toHaveBeenCalledWith("items", labels("data"));
      expect(increment).toHaveBeenCalledWith("item_attempts", labels("data"), 1);
    });

    it("counts a page without products as no_data", async () => {
      const s = setup();
      s.build.mockReturnValueOnce({ ads: [], subcategories: [], hasNextPage: false });
      s.scraper.execute(buildPlpPage());

      s.amazon.respond(0, html);
      await flush();

      expect(s.increment).toHaveBeenCalledWith("responses", labels("no_data"));
      expect(s.increment).not.toHaveBeenCalledWith("items", expect.anything());
    });

    it("counts an empty response", async () => {
      const { amazon, scraper, increment } = setup();
      scraper.execute(buildPlpPage());

      amazon.respond(0, "");
      await flush();

      expect(increment).toHaveBeenCalledWith("responses", labels("empty"));
    });

    it("counts a given up page", async () => {
      const { amazon, scraper, increment } = setup();
      scraper.execute(buildPlpPage());

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        amazon.fail(amazon.requests.length - 1);
        await vi.runAllTimersAsync();
      }

      expect(increment).toHaveBeenCalledWith("items", labels("given_up"));
      expect(increment).toHaveBeenCalledWith(
        "item_attempts",
        labels("given_up"),
        MAX_FAILED_ATTEMPTS
      );
    });
  });
});
