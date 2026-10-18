import { describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";

describe("AmazonPlpScraper", () => {
  it("scrapes the category in every price range", () => {
    const executeCategory = vi.fn();
    const pageScraper = { executeCategory } as unknown as AmazonPlpPageScraper;

    new AmazonPlpScraper(pageScraper).execute("toys");

    expect(executeCategory).toHaveBeenCalledWith("toys");
  });
});
