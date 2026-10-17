import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonScraper } from "@/scrapers/AmazonScraper";
import type { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import type { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import type { ProxyService } from "@/services/ProxyService";
import { buildAd, buildCountry } from "@@tests/support/factories";
import {
  fakeAmazonService,
  fakeApiService,
  fakeArgsService,
} from "@@tests/support/fakes";

const setup = ({ count = 50 } = {}) => {
  const api = fakeApiService();
  const amazon = fakeAmazonService();
  const args = fakeArgsService({ count });
  const pdpExecute = vi.fn();
  const pdpScraper = { execute: pdpExecute } as unknown as AmazonPdpScraper;
  const plpExecute = vi.fn();
  const plpScraper = { execute: plpExecute } as unknown as AmazonPlpScraper;
  const scraper = new AmazonScraper(
    api.service,
    amazon.service,
    args.service,
    pdpScraper,
    plpScraper,
    {} as ProxyService
  );
  return { api, amazon, pdpExecute, plpExecute, scraper };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AmazonScraper", () => {
  describe("scrapPdp", () => {
    const countries = [buildCountry({ id: 1 }), buildCountry({ id: 2 })];
    const ads = [buildAd({ id: 1 }), buildAd({ id: 2 })];

    it("scrapes a batch of ads in every country", async () => {
      const { api, amazon, pdpExecute, scraper } = setup({ count: 50 });
      amazon.queueService.completed = 10;
      amazon.queueService.failed = 3;
      api.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);

      await scraper.scrapPdp();
      await flush();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/scrap?count=50");
      expect(pdpExecute).toHaveBeenCalledWith(ads[0], countries);
      expect(pdpExecute).toHaveBeenCalledWith(ads[1], countries);
      expect(amazon.queueService.completed).toBe(0);
      expect(amazon.queueService.failed).toBe(0);
    });

    it("waits while the queue is longer than a tenth of the batch", async () => {
      const { api, amazon, scraper } = setup({ count: 50 });
      amazon.queueService.queue.push(...Array.from({ length: 6 }, () => vi.fn()));

      await scraper.scrapPdp();
      expect(api.getCountries).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
    });

    it("does not load a new batch while the previous one is loading", async () => {
      const { api, scraper } = setup();
      api.getCountries.mockResolvedValue(countries);
      api.get.mockReturnValue(new Promise(() => {}));

      scraper.scrapPdp();
      await flush();
      await scraper.scrapPdp();

      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["countries", (api: ReturnType<typeof fakeApiService>) =>
        api.getCountries.mockRejectedValueOnce(new Error("down"))],
      ["ads", (api: ReturnType<typeof fakeApiService>) =>
        api.get.mockRejectedValueOnce(new Error("down"))],
    ])("tries again after loading %s fails", async (_name, failOnce) => {
      const { api, pdpExecute, scraper } = setup();
      api.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);
      failOnce(api);

      await scraper.scrapPdp().catch(() => {});
      await flush();
      await scraper.scrapPdp();
      await flush();

      expect(pdpExecute).toHaveBeenCalledWith(ads[0], countries);
    });
  });

  describe("scrapPlp", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("scrapes the category from the backend", async () => {
      const { api, amazon, plpExecute, scraper } = setup();
      amazon.queueService.completed = 4;
      api.get.mockResolvedValue({ id: 1, name: "electronics" });

      await scraper.scrapPlp();
      await flush();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/categories/scrap");
      expect(plpExecute).toHaveBeenCalledWith("electronics");
      expect(amazon.queueService.completed).toBe(0);
    });

    it("asks for the category again a minute after loading fails", async () => {
      vi.useFakeTimers();
      const { api, plpExecute, scraper } = setup();
      api.get
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue({ id: 1, name: "electronics" });

      await scraper.scrapPlp();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(59 * 1000);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(plpExecute).toHaveBeenCalledWith("electronics");
    });
  });
});
