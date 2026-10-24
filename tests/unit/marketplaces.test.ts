import { describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";

vi.mock("@/marketplaces/amazon/AmazonScraper", () => ({
  AmazonScraper: vi.fn(function (this: { marketplace: string }) {
    this.marketplace = "amazon";
  }),
}));

describe("createScraper", () => {
  it("loads the config, starts its refresh and the metrics reporting and returns the Amazon scraper", async () => {
    const calls: string[] = [];
    vi.spyOn(ScraperConfigService, "getInstance").mockReturnValue({
      load: vi.fn(async () => {
        calls.push("load");
      }),
      start: vi.fn(() => calls.push("start")),
    } as unknown as ScraperConfigService);
    const start = vi.fn();
    vi.spyOn(MetricsReporter, "getInstance").mockReturnValue({
      start,
    } as unknown as MetricsReporter);
    vi.mocked(AmazonScraper).mockClear();

    const scraper = await createScraper();

    expect(calls).toEqual(["load", "start"]);
    expect(start).toHaveBeenCalledWith("amazon");
    expect(scraper).toBeInstanceOf(AmazonScraper);
    expect(AmazonScraper).toHaveBeenCalledTimes(1);
  });
});
