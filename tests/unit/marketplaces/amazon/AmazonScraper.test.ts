import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import type { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import type { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { ProxyService } from "@/shared/http/proxy/ProxyService";
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
  const pdpExecute = vi.fn();
  const pdpScraper = { execute: pdpExecute } as unknown as AmazonPdpScraper;
  const plpExecute = vi.fn();
  const plpScraper = { execute: plpExecute } as unknown as AmazonPlpScraper;
  const scraper = new AmazonScraper(
    api.service,
    amazon.service,
    {} as ArgsService,
    pdpScraper,
    plpScraper,
    {} as ProxyService,
    country.service,
    config.service
  );
  return { api, country, amazon, pdpExecute, plpExecute, scraper };
};

type Fakes = Pick<ReturnType<typeof setup>, "api" | "country">;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AmazonScraper", () => {
  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  describe("scrapPdp", () => {
    const countries = [buildAmazonCountry({ countryId: 1 }), buildAmazonCountry({ countryId: 2 })];
    const ads = [buildAd({ id: 1 }), buildAd({ id: 2 })];

    it("scrapes a batch of ads in every country", async () => {
      const { api, country, amazon, pdpExecute, scraper } = setup({ batchSize: 50 });
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);

      await scraper.scrapPdp();
      await flush();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/scrap?batchSize=50");
      expect(pdpExecute).toHaveBeenCalledWith(ads[0], countries);
      expect(pdpExecute).toHaveBeenCalledWith(ads[1], countries);
    });

    it("waits while the queue is longer than a tenth of the batch", async () => {
      const { api, country, amazon, scraper } = setup({ batchSize: 50 });
      amazon.queueService.queue.push(...Array.from({ length: 6 }, () => vi.fn()));

      await scraper.scrapPdp();
      expect(country.getCountries).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
    });

    it("does not load a new batch while the previous one is loading", async () => {
      const { api, country, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockReturnValue(new Promise(() => {}));

      scraper.scrapPdp();
      await flush();
      await scraper.scrapPdp();

      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["countries", (fakes: Fakes) =>
        fakes.country.getCountries.mockRejectedValueOnce(new Error("down"))],
      ["ads", (fakes: Fakes) =>
        fakes.api.get.mockRejectedValueOnce(new Error("down"))],
    ])("tries again after loading %s fails", async (_name, failOnce) => {
      const { api, country, pdpExecute, scraper } = setup();
      country.getCountries.mockResolvedValue(countries);
      api.get.mockResolvedValue(ads);
      failOnce({ api, country });

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
      api.get.mockResolvedValue({ id: 1, name: "electronics" });

      await scraper.scrapPlp();
      await flush();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/categories/scrap");
      expect(plpExecute).toHaveBeenCalledWith({ id: 1, name: "electronics" });
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
      expect(plpExecute).toHaveBeenCalledWith({ id: 1, name: "electronics" });
    });
  });
});
