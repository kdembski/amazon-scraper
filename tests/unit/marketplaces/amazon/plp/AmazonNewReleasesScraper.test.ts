import { describe, expect, it, vi } from "vitest";
import { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";
import { AmazonNewReleasesBuilder } from "@/marketplaces/amazon/plp/AmazonNewReleasesBuilder";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import type { AmazonPlpPageFetcher } from "@/marketplaces/amazon/plp/AmazonPlpPageFetcher";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { newReleasesPage, toDocument } from "@@tests/support/html";
import { fakeApiService } from "@@tests/support/fakes";

// Answers each URL with its page from the map, or gives it up when missing
const setup = (pages: Record<string, string>) => {
  const api = fakeApiService();
  const fetch = vi.fn(async (url: string, _referer: string, build: (document: any) => any) =>
    pages[url] === undefined
      ? { failed: MAX_FAILED_ATTEMPTS }
      : { page: build(toDocument(pages[url])), failed: 0 }
  );
  const increment = vi.fn();
  const scraper = new AmazonNewReleasesScraper(
    { fetch } as unknown as AmazonPlpPageFetcher,
    new AmazonNewReleasesBuilder(),
    { increment } as unknown as MetricsService
  );
  const crawl = new AmazonPlpCrawl("electronics", false, api.service);
  return { api, fetch, increment, scraper, crawl };
};

const asins = (posted: unknown[][]) =>
  posted.flatMap(([, ads]) => (ads as { asin: string }[]).map((ad) => ad.asin));

describe("AmazonNewReleasesScraper", () => {
  it("crawls the browse tree once per node and both pages of every node", async () => {
    const pages: Record<string, string> = {
      "pl/gp/new-releases/electronics": newReleasesPage({ asins: ["B0ROOT"], nodes: ["1", "2"], next: true }),
      "pl/gp/new-releases/electronics?pg=2": newReleasesPage({ asins: ["B0ROOT2"] }),
      "pl/gp/new-releases/electronics/1": newReleasesPage({ asins: ["B0ONE"], nodes: ["1", "2", "3"] }),
      "pl/gp/new-releases/electronics/2": newReleasesPage({ asins: ["B0TWO"], nodes: ["1", "2"] }),
      "pl/gp/new-releases/electronics/3": newReleasesPage({ asins: ["B0THREE"] }),
    };
    const { api, fetch, scraper, crawl } = setup(pages);

    await scraper.execute(crawl);

    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(Object.keys(pages).sort());
    expect(fetch.mock.calls[0][1]).toBe("pl/gp/new-releases/electronics");
    expect(asins(api.post.mock.calls).sort()).toEqual(
      ["B0ONE", "B0ROOT", "B0ROOT2", "B0THREE", "B0TWO"].sort()
    );
  });

  it("sends ads through the crawl, each ASIN once", async () => {
    const { api, increment, scraper, crawl } = setup({
      "pl/gp/new-releases/electronics": newReleasesPage({ asins: ["B0SAME", "B0ROOT"], nodes: ["1"] }),
      "pl/gp/new-releases/electronics/1": newReleasesPage({ asins: ["B0SAME"] }),
    });

    await scraper.execute(crawl);

    expect(asins(api.post.mock.calls)).toEqual(["B0SAME", "B0ROOT"]);
    expect(crawl.asins).toEqual(new Set(["B0SAME", "B0ROOT"]));
    expect(increment).toHaveBeenCalledWith("new_releases_ads", { country: "pl" }, 2);
    expect(increment).toHaveBeenCalledWith("new_releases_ads", { country: "pl" }, 0);
    expect(increment).toHaveBeenCalledWith("new_releases_pages", { country: "pl", outcome: "data" });
  });

  it("counts a given up page and skips its children", async () => {
    const { api, fetch, increment, scraper, crawl } = setup({});

    await scraper.execute(crawl);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
    expect(increment).toHaveBeenCalledWith("new_releases_pages", { country: "pl", outcome: "given_up" });
  });
});
