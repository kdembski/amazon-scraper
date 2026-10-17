import { afterEach, describe, expect, it } from "vitest";
import { buildAd, buildCountry } from "@@tests/support/factories";
import { aodPage } from "@@tests/support/html";
import { Process, spawnScraper } from "@@tests/support/e2e";

const countries = [
  buildCountry({ id: 1, code: "de" }),
  buildCountry({ id: 2, code: "fr" }),
];
const ad = buildAd({ id: 7, asin: "B0TESTASIN" });

describe("PDP process", () => {
  let scraper: Process | undefined;

  afterEach(async (context) => {
    if (context.task.result?.state === "fail") console.log(scraper?.output());
    await scraper?.stop();
  });

  it("scrapes a batch and sends the prices to the backend", async () => {
    scraper = await spawnScraper(["-c", "10", "-l", "5"], ({ backend, amazon }) => {
      backend
        .on("GET", "countries", countries)
        .onSequence("GET", "amazon/ads/scrap", [{ body: [ad] }, { body: [] }]);
      amazon.respondPerCountry({
        de: [aodPage({ price: "24,99", shipsFrom: "Amazon" })],
        fr: [aodPage({ price: "25,49", shipsFrom: "Amazon.fr" })],
      });
    });

    const put = await scraper.backend.waitFor("PUT", "amazon/ads/7", 30 * 1000);

    expect(put.body).toEqual({
      prices: [
        { adId: 7, countryId: 1, value: 24.99, dispatchFrom: "Amazon" },
        { adId: 7, countryId: 2, value: 25.49, dispatchFrom: "Amazon" },
      ],
    });
    expect(scraper.amazon.rejectedTunnels).toBe(0);
  });

  it("deletes an ad that no longer exists", async () => {
    scraper = await spawnScraper(["-c", "10"], ({ backend, amazon }) => {
      backend
        .on("GET", "countries", countries)
        .onSequence("GET", "amazon/ads/scrap", [{ body: [ad] }, { body: [] }]);
      amazon.respond(() => ({ status: 404 }));
    });

    await scraper.backend.waitFor("DELETE", "amazon/ads/7", 30 * 1000);
    expect(scraper.backend.find("PUT", "amazon/ads/7")).toHaveLength(0);
  });

  it("keeps running and loads the batch again after the backend fails", async () => {
    scraper = await spawnScraper(["-c", "10"], ({ backend, amazon }) => {
      backend
        .on("GET", "countries", countries)
        .onSequence("GET", "amazon/ads/scrap", [
          { status: 500 },
          { body: [ad] },
          { body: [] },
        ]);
      amazon.respond(() => aodPage({ price: "24,99" }));
    });

    // The next attempt comes with the 5 s PDP loop
    await scraper.backend.waitFor("PUT", "amazon/ads/7", 30 * 1000);
    expect(scraper.child.exitCode).toBeNull();
  });
});
