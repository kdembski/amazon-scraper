import { describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonScraper } from "@/scrapers/AmazonScraper";
import { ScraperStatusService } from "@/shared/backend/ScraperStatusService";

vi.mock("@/scrapers/AmazonScraper", () => ({ AmazonScraper: vi.fn() }));

describe("createScraper", () => {
  it("starts the scraper status reporting and returns the Amazon scraper", () => {
    const getInstance = vi
      .spyOn(ScraperStatusService, "getInstance")
      .mockReturnValue({} as ScraperStatusService);

    const scraper = createScraper();

    expect(getInstance).toHaveBeenCalledTimes(1);
    expect(scraper).toBeInstanceOf(AmazonScraper);
  });
});
