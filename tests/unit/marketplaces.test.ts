import { describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperStatusService } from "@/shared/backend/ScraperStatusService";

vi.mock("@/marketplaces/amazon/AmazonScraper", () => ({
  AmazonScraper: vi.fn(function (this: { marketplace: string }) {
    this.marketplace = "amazon";
  }),
}));

describe("createScraper", () => {
  it("starts the status and metrics reporting and returns the Amazon scraper", () => {
    const getInstance = vi
      .spyOn(ScraperStatusService, "getInstance")
      .mockReturnValue({} as ScraperStatusService);
    const start = vi.fn();
    vi.spyOn(MetricsReporter, "getInstance").mockReturnValue({
      start,
    } as unknown as MetricsReporter);

    const scraper = createScraper();

    expect(getInstance).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("amazon");
    expect(scraper).toBeInstanceOf(AmazonScraper);
  });
});
