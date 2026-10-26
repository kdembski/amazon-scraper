import { describe, expect, it, vi } from "vitest";
import { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import type { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";

const setup = () => {
  const executeCategory = vi.fn();
  let finishNewReleases!: () => void;
  const execute = vi.fn(() => new Promise<void>((resolve) => (finishNewReleases = resolve)));
  const scraper = new AmazonPlpCategoryScraper(
    { executeCategory } as unknown as AmazonPlpPageScraper,
    { execute } as unknown as AmazonNewReleasesScraper
  );
  return { scraper, executeCategory, execute, finishNewReleases: () => finishNewReleases() };
};

describe("AmazonPlpCategoryScraper", () => {
  it.each([
    ["all pages of a category never scraped", null, true],
    ["the first page of a category scraped before", "2026-10-18T10:00:00.000Z", false],
  ])("scrapes %s", async (_name, scrapedAt, allPages) => {
    const { scraper, executeCategory, finishNewReleases } = setup();

    const done = scraper.execute({ id: 1, name: "toys", scrapedAt });
    finishNewReleases();
    await done;

    expect(executeCategory).toHaveBeenCalledWith("toys", allPages);
  });

  it("searches the listings only after the new releases are crawled", async () => {
    const { scraper, executeCategory, execute, finishNewReleases } = setup();

    const done = scraper.execute({ id: 1, name: "toys", scrapedAt: null });
    await Promise.resolve();

    expect(execute).toHaveBeenCalledWith("toys");
    expect(executeCategory).not.toHaveBeenCalled();

    finishNewReleases();
    await done;
    expect(executeCategory).toHaveBeenCalled();
  });
});
