import { describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";

vi.mock("@/marketplaces/amazon/AmazonScraper", () => ({
  AmazonScraper: vi.fn(function (this: { marketplace: string }) {
    this.marketplace = "amazon";
  }),
}));

describe("createScraper", () => {
  it("starts the metrics reporting and returns the Amazon scraper", () => {
    const start = vi.fn();
    vi.spyOn(MetricsReporter, "getInstance").mockReturnValue({
      start,
    } as unknown as MetricsReporter);

    const scraper = createScraper();

    expect(start).toHaveBeenCalledWith("amazon");
    expect(scraper).toBeInstanceOf(AmazonScraper);
  });
});
