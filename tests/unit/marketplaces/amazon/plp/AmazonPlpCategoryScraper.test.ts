import { describe, expect, it, vi } from "vitest";
import { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import type { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";

const setup = () => {
  const executePages = vi.fn(async (_crawl: AmazonPlpCrawl) => {});
  let finishNewReleases!: () => void;
  const execute = vi.fn(
    (_crawl: AmazonPlpCrawl) => new Promise<void>((resolve) => (finishNewReleases = resolve))
  );
  const scraper = new AmazonPlpCategoryScraper(
    { execute: executePages } as unknown as AmazonPlpPageScraper,
    { execute } as unknown as AmazonNewReleasesScraper
  );
  return { scraper, executePages, execute, finishNewReleases: () => finishNewReleases() };
};

describe("AmazonPlpCategoryScraper", () => {
  it.each([
    ["all pages of a category never scraped", null, true],
    ["the first page of a category scraped before", "2026-10-18T10:00:00.000Z", false],
  ])("scrapes %s", async (_name, scrapedAt, allPages) => {
    const { scraper, executePages, execute, finishNewReleases } = setup();

    const done = scraper.execute({ id: 1, name: "toys", scrapedAt });
    finishNewReleases();
    await done;

    const crawl = execute.mock.calls[0][0];
    expect(crawl).toBeInstanceOf(AmazonPlpCrawl);
    expect(crawl).toMatchObject({ category: "toys", allPages });
    expect(executePages).toHaveBeenCalledWith(crawl);
  });

  it("searches the listings only after the new releases are crawled", async () => {
    const { scraper, executePages, execute, finishNewReleases } = setup();

    const done = scraper.execute({ id: 1, name: "toys", scrapedAt: null });
    await Promise.resolve();

    expect(execute).toHaveBeenCalled();
    expect(executePages).not.toHaveBeenCalled();

    finishNewReleases();
    await done;
    expect(executePages).toHaveBeenCalled();
  });

  it("resolves only after the listings are searched", async () => {
    const { scraper, executePages, finishNewReleases } = setup();
    let finishPages!: () => void;
    executePages.mockImplementation(() => new Promise<void>((resolve) => (finishPages = resolve)));
    let done = false;

    scraper.execute({ id: 1, name: "toys", scrapedAt: null }).then(() => (done = true));
    finishNewReleases();
    await vi.waitFor(() => expect(executePages).toHaveBeenCalled());
    await Promise.resolve();
    expect(done).toBe(false);

    finishPages();
    await vi.waitFor(() => expect(done).toBe(true));
  });
});
