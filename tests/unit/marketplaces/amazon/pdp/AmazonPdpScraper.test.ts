import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import type { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import {
  fakeApiService,
  fakeScraperConfigService,
  fakeAmazonCountryService,
  fakeTokenBucketQueue,
} from "@@tests/support/fakes";

const setup = ({ batchSize = 50, rps = 0, concurrency = 10, inFlight = 0 } = {}) => {
  const api = fakeApiService();
  const country = fakeAmazonCountryService();
  const queue = fakeTokenBucketQueue();
  const config = fakeScraperConfigService({ batchSize, rps, concurrency });
  const adExecute = vi.fn();
  const adScraper = { execute: adExecute, inFlight } as unknown as AmazonPdpAdScraper;
  const increment = vi.fn();
  const scraper = new AmazonPdpScraper(
    api.service,
    queue.service,
    adScraper,
    country.service,
    config.service,
    { increment } as unknown as MetricsService
  );
  return { api, country, queue, adExecute, scraper, increment };
};

type Fakes = Pick<ReturnType<typeof setup>, "api" | "country">;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AmazonPdpScraper", () => {
  const countries = [buildAmazonCountry({ countryId: 1 }), buildAmazonCountry({ countryId: 2 })];
  const ads = [buildAd({ id: 1 }), buildAd({ id: 2 })];

  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("execute", () => {

    it("loads a batch now and every second", async () => {
      vi.useFakeTimers({ now: new Date("2026-01-15T12:00:00Z") });
      const { api, country, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue([]);

      scraper.execute();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it("waits a second after a load finishes before the next one", async () => {
      vi.useFakeTimers({ now: new Date("2026-01-15T12:00:00Z") });
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
      await vi.advanceTimersByTimeAsync(999);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("scrape", () => {
    it("loads no batch at night and resumes in the morning", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { api, country, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue([]);

      vi.setSystemTime(new Date("2026-01-15T22:00:00Z"));
      await scraper.scrape();
      expect(api.get).not.toHaveBeenCalled();

      vi.setSystemTime(new Date("2026-01-16T06:00:00Z"));
      await scraper.scrape();
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(log.mock.calls).toEqual([
        ["pdp: night pause started"],
        ["pdp: night pause ended"],
      ]);
    });

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

    it.each([
      ["5 s of rps", { rps: 2 }, 10],
      ["twice the concurrency without rps", { concurrency: 3 }, 6],
    ])("loads only while the queue holds less than %s", async (_name, config, lowWater) => {
      const { api, country, queue, scraper } = setup(config);
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue([]);
      queue.queue.push(...Array.from({ length: lowWater - 1 }, () => vi.fn()));

      await scraper.scrape();
      expect(api.get).toHaveBeenCalledTimes(1);

      queue.queue.push(vi.fn());
      await scraper.scrape();
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("tops the ads in flight up to the batch size once a quarter is missing", async () => {
      const { api, country, scraper } = setup({ batchSize: 100, inFlight: 75 });
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue([]);

      await scraper.scrape();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/scrap?batchSize=25");
    });

    it("waits while less than a quarter of the batch is missing", async () => {
      const { api, country, scraper } = setup({ batchSize: 100, inFlight: 76 });

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
