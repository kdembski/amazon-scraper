import { describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";

describe("AmazonPlpScraper", () => {
  it.each([
    ["all pages of a category never scraped", null, true],
    ["the first page of a category scraped before", "2026-10-18T10:00:00.000Z", false],
  ])("scrapes %s", (_name, scrapedAt, allPages) => {
    const executeCategory = vi.fn();
    const pageScraper = { executeCategory } as unknown as AmazonPlpPageScraper;

    new AmazonPlpScraper(pageScraper).execute({ id: 1, name: "toys", scrapedAt });

    expect(executeCategory).toHaveBeenCalledWith("toys", allPages);
  });
});
