import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { newReleasesPage } from "@@tests/support/html";
import {
  fakeAmazonService,
  fakeApiService,
  fakeScraperConfigService,
} from "@@tests/support/fakes";

const setup = ({ batchSize = 50 } = {}) => {
  const amazon = fakeAmazonService();
  const config = fakeScraperConfigService({ batchSize });
  const api = fakeApiService();
  const increment = vi.fn();
  const scraper = new AmazonNewReleasesScraper(
    api.service,
    amazon.service,
    config.service,
    undefined,
    { increment } as unknown as MetricsService
  );
  return { amazon, api, scraper, increment };
};

const flush = () => vi.advanceTimersByTimeAsync(0);
const asins = (posted: unknown[][]) =>
  posted.flatMap(([, ads]) => (ads as { asin: string }[]).map((ad) => ad.asin));

describe("AmazonNewReleasesScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("crawls the browse tree once per node and both pages of every node", async () => {
    const { amazon, api, scraper } = setup();
    const pages: Record<string, string> = {
      "pl/gp/new-releases/electronics": newReleasesPage({ asins: ["B0ROOT"], nodes: ["1", "2"], next: true }),
      "pl/gp/new-releases/electronics?pg=2": newReleasesPage({ asins: ["B0ROOT2"] }),
      "pl/gp/new-releases/electronics/1": newReleasesPage({ asins: ["B0ONE"], nodes: ["1", "2", "3"] }),
      "pl/gp/new-releases/electronics/2": newReleasesPage({ asins: ["B0TWO"], nodes: ["1", "2"] }),
      "pl/gp/new-releases/electronics/3": newReleasesPage({ asins: ["B0THREE"] }),
    };
    let done = false;
    scraper.execute("electronics").then(() => (done = true));

    for (let i = 0; i < 10; i++) {
      amazon.requests.forEach((request, index) => {
        if (!(request as any).answered) {
          (request as any).answered = true;
          amazon.respond(index, pages[request.url]);
        }
      });
      await flush();
    }

    expect(done).toBe(true);
    expect(amazon.requests.map(({ url }) => url).sort()).toEqual(Object.keys(pages).sort());
    expect(amazon.requests[0].referer).toBe("pl/gp/new-releases/electronics");
    expect(asins(api.post.mock.calls).sort()).toEqual(
      ["B0ONE", "B0ROOT", "B0ROOT2", "B0THREE", "B0TWO"].sort()
    );
  });

  it("sends an ASIN only once per crawl", async () => {
    const { amazon, api, scraper, increment } = setup();
    scraper.execute("electronics");

    amazon.respond(0, newReleasesPage({ asins: ["B0SAME", "B0ROOT"], nodes: ["1"] }));
    await flush();
    amazon.respond(1, newReleasesPage({ asins: ["B0SAME"] }));
    await flush();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("amazon/ads", [
      expect.objectContaining({ asin: "B0SAME" }),
      expect.objectContaining({ asin: "B0ROOT" }),
    ]);
    expect(increment).toHaveBeenCalledWith("new_releases_ads", { country: "pl" }, 2);
    expect(increment).toHaveBeenCalledWith("new_releases_ads", { country: "pl" }, 0);
  });

  it("retries an invalid page and a failed request", async () => {
    const { amazon, scraper, increment } = setup();
    scraper.execute("electronics");

    amazon.respond(0, "<html></html>");
    await vi.advanceTimersByTimeAsync(1000);
    amazon.fail(1);
    await vi.advanceTimersByTimeAsync(2000);
    amazon.respond(2, newReleasesPage());
    await flush();

    expect(amazon.requests).toHaveLength(3);
    expect(increment).toHaveBeenCalledWith("new_releases_pages", { country: "pl", outcome: "data" });
  });

  it("waits while the request queue is full", async () => {
    const { amazon, scraper } = setup({ batchSize: 2 });
    amazon.queueService.queue.push(vi.fn(), vi.fn());
    scraper.execute("electronics");

    await vi.advanceTimersByTimeAsync(3000);
    expect(amazon.requests).toHaveLength(0);

    amazon.queueService.queue.pop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(amazon.requests).toHaveLength(1);
  });

  it("gives up on a page after the attempt limit", async () => {
    const { amazon, api, scraper, increment } = setup();
    let done = false;
    scraper.execute("electronics").then(() => (done = true));

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      amazon.fail(i);
      await vi.advanceTimersByTimeAsync(60 * 1000);
    }

    expect(done).toBe(true);
    expect(amazon.requests).toHaveLength(MAX_FAILED_ATTEMPTS);
    expect(api.post).not.toHaveBeenCalled();
    expect(increment).toHaveBeenCalledWith("new_releases_pages", { country: "pl", outcome: "given_up" });
  });
});
