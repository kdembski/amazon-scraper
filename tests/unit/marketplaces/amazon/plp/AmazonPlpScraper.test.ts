import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { fakeApiService } from "@@tests/support/fakes";

const electronics = { id: 1, name: "electronics", scrapedAt: null };

// Every category scrape stays pending until the test finishes it
const setup = () => {
  const api = fakeApiService();
  const finishers: (() => void)[] = [];
  const categoryExecute = vi.fn(
    () => new Promise<void>((resolve) => finishers.push(resolve))
  );
  const categoryScraper = { execute: categoryExecute } as unknown as AmazonPlpCategoryScraper;
  const scraper = new AmazonPlpScraper(api.service, categoryScraper);
  return { api, categoryExecute, finishers, scraper };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("AmazonPlpScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  it("scrapes the next category right after the previous one finishes", async () => {
    const { api, categoryExecute, finishers, scraper } = setup();
    api.get.mockResolvedValue(electronics);

    scraper.execute();
    await flush();

    expect(api.get).toHaveBeenCalledWith("amazon/ads/categories/scrap");
    expect(categoryExecute).toHaveBeenCalledWith(electronics);
    expect(api.get).toHaveBeenCalledTimes(1);

    finishers[0]();
    await flush();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(categoryExecute).toHaveBeenCalledTimes(2);
  });

  it("asks for the category again a minute after loading fails", async () => {
    const { api, categoryExecute, scraper } = setup();
    api.get.mockRejectedValueOnce(new Error("down")).mockResolvedValue(electronics);

    scraper.execute();
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(categoryExecute).toHaveBeenCalledWith(electronics);
  });

  it("asks for the category again a minute after scraping it fails", async () => {
    const { api, categoryExecute, scraper } = setup();
    api.get.mockResolvedValue(electronics);
    categoryExecute.mockRejectedValueOnce(new Error("down"));

    scraper.execute();
    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(categoryExecute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(categoryExecute).toHaveBeenCalledTimes(2);
  });
});
