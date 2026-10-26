import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { fakeApiService } from "@@tests/support/fakes";

const setup = () => {
  const api = fakeApiService();
  const categoryExecute = vi.fn();
  const categoryScraper = { execute: categoryExecute } as unknown as AmazonPlpCategoryScraper;
  const scraper = new AmazonPlpScraper(api.service, categoryScraper);
  return { api, categoryExecute, scraper };
};

describe("AmazonPlpScraper", () => {
  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  describe("scrape", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("scrapes the category from the backend", async () => {
      const { api, categoryExecute, scraper } = setup();
      api.get.mockResolvedValue({ id: 1, name: "electronics" });

      await scraper.scrape();

      expect(api.get).toHaveBeenCalledWith("amazon/ads/categories/scrap");
      expect(categoryExecute).toHaveBeenCalledWith({ id: 1, name: "electronics" });
    });

    it("asks for the category again a minute after loading fails", async () => {
      vi.useFakeTimers();
      const { api, categoryExecute, scraper } = setup();
      api.get
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue({ id: 1, name: "electronics" });

      await scraper.scrape();
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(59 * 1000);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(categoryExecute).toHaveBeenCalledWith({ id: 1, name: "electronics" });
    });

    it("asks for the category again a minute after scraping it fails", async () => {
      vi.useFakeTimers();
      const { api, categoryExecute, scraper } = setup();
      api.get.mockResolvedValue({ id: 1, name: "electronics" });
      categoryExecute.mockRejectedValueOnce(new Error("down"));

      await scraper.scrape();
      await vi.advanceTimersByTimeAsync(60 * 1000);

      expect(categoryExecute).toHaveBeenCalledTimes(2);
    });
  });
});
