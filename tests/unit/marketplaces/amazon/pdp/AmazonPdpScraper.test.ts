import { describe, expect, it, vi } from "vitest";
import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import type { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";

const setup = () => {
  const execute = vi.fn();
  const countryScraper = { execute } as unknown as AmazonPdpCountryScraper;
  return { execute, scraper: new AmazonPdpScraper(countryScraper) };
};

describe("AmazonPdpScraper", () => {
  const ad = buildAd();
  const countries = [
    buildAmazonCountry({ countryId: 1, tld: "de" }),
    buildAmazonCountry({ countryId: 2, tld: "fr" }),
  ];

  it("starts every country with a fresh price state", () => {
    const { execute, scraper } = setup();
    scraper.execute(ad, countries);

    expect(execute).toHaveBeenCalledTimes(2);
    const prices = execute.mock.calls[0][2];
    expect(prices).toEqual([
      {
        country: countries[0],
        pending: false,
        complete: false,
        deleted: false,
        adDeleted: false,
        failed: 0,
      },
      {
        country: countries[1],
        pending: false,
        complete: false,
        deleted: false,
        adDeleted: false,
        failed: 0,
      },
    ]);
    expect(execute.mock.calls[0]).toEqual([prices[0], ad, prices, expect.any(Function)]);
    expect(execute.mock.calls[1]).toEqual([prices[1], ad, prices, expect.any(Function)]);
  });

  it("shares one resolve between all countries", () => {
    const { execute, scraper } = setup();
    scraper.execute(ad, countries);

    expect(execute.mock.calls[0][3]).toBe(execute.mock.calls[1][3]);
  });

  it("resolves once the country scraper resolves the ad", async () => {
    const { execute, scraper } = setup();
    const done = vi.fn();
    scraper.execute(ad, countries).then(done);

    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    execute.mock.calls[0][3]();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
  });
});
