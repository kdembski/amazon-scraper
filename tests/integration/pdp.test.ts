import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { cronJobs } from "@@tests/support/cron";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import { aodPage, captchaPage } from "@@tests/support/html";
import {
  bootScraper,
  sleep,
  startWorld,
  stopWorld,
  World,
} from "@@tests/support/integration";

const countries = [
  buildAmazonCountry({ countryId: 1, tld: "de" }),
  buildAmazonCountry({ countryId: 2, tld: "fr" }),
  buildAmazonCountry({ countryId: 3, tld: "it" }),
];
const ad = buildAd({ id: 7, asin: "B0TESTASIN" });
const sixCountries = ["de", "fr", "it", "es", "nl", "se"].map((code, i) =>
  buildAmazonCountry({ countryId: i + 1, tld: code })
);

const offers = {
  de: [aodPage({ price: "24,99", shipsFrom: "Amazon" })],
  fr: [aodPage({ price: "25,49", shipsFrom: "Amazon.fr" })],
  it: [aodPage({ price: "26,00", shipsFrom: "Some Seller" })],
};

const price = (countryId: number, value: number, dispatchFrom: string) => ({
  adId: ad.id,
  countryId,
  value,
  dispatchFrom,
});

describe("PDP", () => {
  let world: World;

  beforeEach(async () => {
    world = await startWorld();
    world.backend
      .on("GET", "amazon/countries/scrap", countries)
      .onSequence("GET", "amazon/ads/scrap", [{ body: [ad] }, { body: [] }]);
  });

  afterEach(() => stopWorld(world));

  const scrape = async (args: string[] = []) => {
    const booted = await bootScraper(args);
    booted.scraper.execute();
    return booted;
  };

  it("sends the price from every country to the backend", async () => {
    world.amazon.respondPerCountry(offers);
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(world.backend.find("GET", "amazon/ads/scrap")[0].query.get("batchSize")).toBe("10");
    expect(put.body).toEqual({
      prices: [
        price(1, 24.99, "Amazon"),
        price(2, 25.49, "Amazon"),
        price(3, 26, "Some Seller"),
      ],
    });
  });

  it("requests the offers fragment through the proxy", async () => {
    world.amazon.respondPerCountry(offers);
    scrape();
    await world.backend.waitFor("PUT", "amazon/ads/7");

    const { requests, rejectedTunnels } = world.amazon;
    expect(rejectedTunnels).toBe(0);
    expect(requests.map((request) => request.url).sort()).toEqual([
      "de/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp",
      "fr/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp",
      "it/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp",
    ]);

    const de = world.amazon.requestsTo("de")[0];
    expect(de.headers.referer).toBe("https://www.amazon.de/dp/B0TESTASIN");
    expect(de.headers["user-agent"]).toMatch(/Mozilla/);
  });


  it("leaves out a country without an offer", async () => {
    world.amazon.respondPerCountry({ ...offers, it: [aodPage()] });
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(put.body.prices.map((p: any) => p.countryId)).toEqual([1, 2]);
  });

  it("retries a country after a captcha, a bot page, a dropped connection and a server error", async () => {
    world.amazon.respondPerCountry({
      ...offers,
      de: [
        captchaPage,
        "<div id='bot-check'></div>",
        { destroy: true },
        { status: 503 },
        ...offers.de,
      ],
    });
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(world.amazon.requestsTo("de")).toHaveLength(5);
    expect(put.body.prices[0]).toEqual(price(1, 24.99, "Amazon"));
  });

  it("gives up on a country after the attempt limit", async () => {
    world.amazon.respondPerCountry({ ...offers, de: [{ status: 503 }] });
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(world.amazon.requestsTo("de")).toHaveLength(MAX_FAILED_ATTEMPTS);
    expect(put.body.prices.map((p: any) => p.countryId)).toEqual([2, 3]);
  });

  it("leaves out a country where the product does not exist", async () => {
    world.backend.on("GET", "amazon/countries/scrap", [
      ...countries,
      buildAmazonCountry({ countryId: 4, tld: "es" }),
    ]);
    world.amazon.respondPerCountry({
      ...offers,
      es: [aodPage({ price: "27,00" })],
      it: [{ status: 404 }],
    });
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(world.amazon.requestsTo("it")).toHaveLength(1);
    expect(put.body.prices.map((p: any) => p.countryId)).toEqual([1, 2, 4]);
  });

  it("deletes the ad when at most two countries are left", async () => {
    world.amazon.respondPerCountry({ ...offers, de: [{ status: 404 }] });
    scrape();

    await world.backend.waitFor("DELETE", "amazon/ads/7");
    await sleep(200);

    expect(world.backend.find("PUT", "amazon/ads/7")).toHaveLength(0);
  });

  it("loads the next batch on a later tick", async () => {
    const next = buildAd({ id: 8, asin: "B0NEXTASIN" });
    world.backend.onSequence("GET", "amazon/ads/scrap", [
      { body: [ad] },
      { body: [next] },
      { body: [] },
    ]);
    world.amazon.respond(({ url }) =>
      aodPage({ price: url.includes("B0NEXTASIN") ? "9,99" : "24,99" })
    );
    scrape();
    await world.backend.waitFor("PUT", "amazon/ads/7");

    vi.advanceTimersByTime(5 * 1000);
    const put = await world.backend.waitFor("PUT", "amazon/ads/8");

    expect(put.body.prices.map((p: any) => p.value)).toEqual([9.99, 9.99, 9.99]);
    expect(world.backend.find("GET", "amazon/countries/scrap")).toHaveLength(1);
  });

  it("loads the batch again after the backend fails", async () => {
    world.backend.onSequence("GET", "amazon/ads/scrap", [
      { status: 500 },
      { body: [ad] },
      { body: [] },
    ]);
    world.amazon.respondPerCountry(offers);
    const { scraper } = await bootScraper();
    await ProxyService.getInstance().loadProxies();

    await expect(scraper.scrapPdp()).rejects.toThrow();
    await scraper.scrapPdp();

    await world.backend.waitFor("PUT", "amazon/ads/7");
  });

  it("keeps at most concurrency requests in flight", async () => {
    world.backend.on("GET", "scrapers/it/config", { concurrency: 2, rps: 0, batchSize: 10 });
    world.backend.on("GET", "amazon/countries/scrap", sixCountries);
    world.amazon.respond(() => ({ body: aodPage({ price: "1,00" }), delay: 100 }));
    scrape();

    const put = await world.backend.waitFor("PUT", "amazon/ads/7");

    expect(put.body.prices).toHaveLength(6);
    expect(world.amazon.maxInFlight).toBe(2);
  });

  it("starts at most rps requests per second", async () => {
    world.backend.on("GET", "scrapers/it/config", { concurrency: 10, rps: 2, batchSize: 10 });
    world.backend.on("GET", "amazon/countries/scrap", sixCountries);
    world.amazon.respond(() => aodPage({ price: "1,00" }));
    scrape();

    await world.backend.waitFor("PUT", "amazon/ads/7");

    // A full bucket of 2, then 2 more every second
    const times = world.amazon.requests.map((request) => request.at);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(1500);
  });

  it("applies a concurrency change from the backend on the next refresh", async () => {
    world.amazon.respondPerCountry(offers);
    const { queue } = await scrape();
    expect(queue.concurrency).toBe(10);

    world.backend.on("GET", "scrapers/it/config", { concurrency: 2, rps: 0, batchSize: 10 });
    await Promise.all(
      cronJobs
        .filter((job) => job.cronTime === "0 * * * * *")
        .map((job) => job.onTick())
    );

    expect(queue.concurrency).toBe(2);
  });

  it("reports metrics every minute", async () => {
    world.amazon.respondPerCountry(offers);
    scrape();
    await world.backend.waitFor("PUT", "amazon/ads/7");

    cronJobs
      .filter((job) => job.cronTime === "0 * * * * *")
      .forEach((job) => job.onTick());

    const post = await world.backend.waitFor("POST", "scrapers/it/metrics");
    const { metrics, ...rest } = post.body;
    expect(rest).toMatchObject({ marketplace: "amazon", flow: "pdp" });
    const value = (metric: string, country?: string, outcome?: string) =>
      metrics.find(
        (m: any) =>
          m.metric === metric && m.country === country && m.outcome === outcome
      )?.value;
    ["de", "fr", "it"].forEach((country) => {
      expect(value("requests", country, "ok")).toBe(1);
      expect(value("responses", country, "data")).toBe(1);
      expect(value("items", country, "data")).toBe(1);
    });
    expect(value("connections")).toBeGreaterThanOrEqual(1);
    expect(value("bytes_in")).toBeGreaterThan(0);
    expect(value("bytes_out")).toBeGreaterThan(0);
  });
});
