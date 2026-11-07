import { describe, expect, it, vi } from "vitest";
import { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";

const setup = () => {
  const executePages = vi.fn(async (_crawl: AmazonPlpCrawl) => {});
  const scraper = new AmazonPlpCategoryScraper(
    { execute: executePages } as unknown as AmazonPlpPageScraper
  );
  return { scraper, executePages };
};

describe("AmazonPlpCategoryScraper", () => {
  it.each([
    ["all pages of a category never scraped", null, true],
    ["the first page of a category scraped before", "2026-10-18T10:00:00.000Z", false],
  ])("scrapes %s", async (_name, scrapedAt, allPages) => {
    const { scraper, executePages } = setup();

    await scraper.execute({ id: 1, name: "toys", scrapedAt });

    const crawl = executePages.mock.calls[0][0];
    expect(crawl).toBeInstanceOf(AmazonPlpCrawl);
    expect(crawl).toMatchObject({ category: "toys", allPages });
  });

  it("resolves only after the listings are searched", async () => {
    const { scraper, executePages } = setup();
    let finishPages!: () => void;
    executePages.mockImplementation(() => new Promise<void>((resolve) => (finishPages = resolve)));
    let done = false;

    scraper.execute({ id: 1, name: "toys", scrapedAt: null }).then(() => (done = true));
    await vi.waitFor(() => expect(executePages).toHaveBeenCalled());
    await Promise.resolve();
    expect(done).toBe(false);

    finishPages();
    await vi.waitFor(() => expect(done).toBe(true));
  });
});
