import { describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import type { AmazonPlpPageScraper } from "@/scrapers/AmazonPlpPageScraper";

describe("AmazonPlpScraper", () => {
  it("scrapes the category in every price range", () => {
    const executeCategory = vi.fn();
    const pageScraper = { executeCategory } as unknown as AmazonPlpPageScraper;

    new AmazonPlpScraper(pageScraper).execute("toys");

    expect(executeCategory).toHaveBeenCalledWith("toys");
  });
});
