import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import type { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import {
  fakeAmazonService,
  fakeApiService,
  fakeScraperConfigService,
  fakeAmazonCountryService,
} from "@@tests/support/fakes";

const setup = ({ batchSize = 50 } = {}) => {
  const api = fakeApiService();
  const country = fakeAmazonCountryService();
  const amazon = fakeAmazonService();
  const config = fakeScraperConfigService({ batchSize });
  const adExecute = vi.fn();
  const adScraper = { execute: adExecute } as unknown as AmazonPdpAdScraper;
  const increment = vi.fn();
  const scraper = new AmazonPdpScraper(
    api.service,
    amazon.service,
    adScraper,
    country.service,
    config.service,
    { increment } as unknown as MetricsService
  );
  return { api, country, amazon, adExecute, scraper, increment };
};

type Fakes = Pick<ReturnType<typeof setup>, "api" | "country">;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AmazonPdpScraper", () => {
  const countries = [buildAmazonCountry({ countryId: 1 }), buildAmazonCountry({ countryId: 2 })];
  const ads = [buildAd({ id: 1 }), buildAd({ id: 2 })];

  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("execute", () => {

    it("loads a batch now and every 5 s", async () => {
      vi.useFakeTimers();
      const { api, country, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue([]);

      scraper.execute();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 1000);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it("waits 5 s after a load finishes before the next one", async () => {
      vi.useFakeTimers();
      const { api, country, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      let finish = () => {};
      api.get
        .mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve([]))))
        .mockResolvedValue([]);

      scraper.execute();
      await vi.advanceTimersByTimeAsync(10 * 1000);
      expect(api.get).toHaveBeenCalledTimes(1);

      finish();
      await vi.advanceTimersByTimeAsync(4 * 1000);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("scrape", () => {
    it("logs and counts a failed load instead of rejecting", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { country, scraper, increment } = setup();
      country.getCountries.mockRejectedValue(new Error("down"));

      await expect(scraper.scrape()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith("pdp: batch load failed", expect.any(Error));
      expect(increment.mock.calls).toEqual([["batch_load", { outcome: "failed" }]]);
    });

    it.each([
      ["ok", ads],
      ["empty", []],
    ])("counts a loaded batch as %s", async (outcome, loaded) => {
      const { api, country, scraper, increment } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(loaded);

      await scraper.scrape();

      expect(increment.mock.calls).toEqual([["batch_load", { outcome }]]);
    });

    it("scrapes a batch of ads in every country", async () => {
      const { api, country, adExecute, scraper } = setup({ batchSize: 50 });
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);

      await scraper.scrape();
      await flush();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/scrap?batchSize=50");
      expect(adExecute).toHaveBeenCalledWith(ads[0], countries);
      expect(adExecute).toHaveBeenCalledWith(ads[1], countries);
    });

    it("waits while the queue is longer than a tenth of the batch", async () => {
      const { api, country, amazon, scraper } = setup({ batchSize: 50 });
      amazon.queueService.queue.push(...Array.from({ length: 6 }, () => vi.fn()));

      await scraper.scrape();
      expect(country.getCountries).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
    });

    it.each([
      ["countries", (fakes: Fakes) =>
        fakes.country.getCountries.mockRejectedValueOnce(new Error("down"))],
      ["ads", (fakes: Fakes) =>
        fakes.api.get.mockRejectedValueOnce(new Error("down"))],
    ])("tries again after loading %s fails", async (_name, failOnce) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { api, country, adExecute, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);
      failOnce({ api, country });

      await scraper.scrape();
      await flush();
      await scraper.scrape();
      await flush();

      expect(adExecute).toHaveBeenCalledWith(ads[0], countries);
    });
  });
});
