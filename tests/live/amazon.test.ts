import { configDotenv } from "dotenv";
import { parseHTML } from "linkedom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import { AmazonPlpBuilder } from "@/marketplaces/amazon/plp/AmazonPlpBuilder";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { AmazonAdBuilder, AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";
import { buildAd, buildCountry } from "@@tests/support/factories";

// Real Amazon through the real webshare proxies (PROXY_LIST_TOKEN from .env).
// Catches layout changes that break the builders silently: it checks that
// pages are still recognized and prices still found, not exact values.
// Amazon blocks part of the requests (captcha, 503), those are retried and
// then skipped; a test fails only if nothing got through at all.

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

configDotenv();
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

// LIVE_ASINS / LIVE_MARKETS override the defaults, comma separated
const list = (value: string | undefined, fallback: string[]) =>
  value ? value.split(",").map((item) => item.trim()) : fallback;

// Batteries sold by Amazon itself in every EU marketplace under one ASIN:
// Amazon Basics AAA 36x, Amazon Basics AA 40x, Varta AA 40x
const asins = list(process.env.LIVE_ASINS, [
  "B00LH3DMUO",
  "B07MLFBJG3",
  "B001P026Z6",
]);
const markets = list(process.env.LIVE_MARKETS, [
  "de",
  "fr",
  "it",
  "es",
  "nl",
  "pl",
  "se",
]);
const ATTEMPTS = 5;

type Result = { code: string; asin: string } & (
  | AmazonAdBuildResult
  | { blocked: string }
);

let amazon: AmazonService;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchPage = (url: string, referer: string) =>
  new Promise<string>((resolve, reject) =>
    amazon.get<string>(url, referer, { onSuccess: resolve, onError: reject })
  );

// Asks again through another random proxy when blocked, with a growing pause
// so the test itself does not trigger throttling
const scrape = async (
  url: string,
  referer: string,
  build: (document: Document) => AmazonAdBuildResult
) => {
  let blocked = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { document } = parseHTML(await fetchPage(url, referer));
      const result = build(document as unknown as Document);
      if (!result.isCaptcha) return result;
      blocked = "captcha";
    } catch (e: any) {
      blocked = e.status ? `HTTP ${e.status}` : e.message;
    }
    await sleep(1000 * attempt);
  }

  return { blocked };
};

const scrapeAll = (builder: AmazonAdBuilder, codes: string[]) =>
  Promise.all(
    asins.flatMap((asin) =>
      codes.map(async (code): Promise<Result> => {
        const ad = buildAd({ asin });
        const { url, referer } = builder.buildUrl(buildCountry({ code }), ad);
        const result = await scrape(url, referer, (d) => builder.build(d));
        return { code, asin, ...result };
      })
    )
  );

const summarize = (results: Result[]) =>
  results.map((result) =>
    "blocked" in result
      ? `${result.asin} ${result.code}: blocked (${result.blocked})`
      : `${result.asin} ${result.code}: ${result.price ?? "no price"} / ${result.dispatchFrom ?? "-"}`
  );

const answeredOf = (results: Result[]) =>
  results.filter(
    (result): result is Result & AmazonAdBuildResult => !("blocked" in result)
  );

describe("live Amazon", () => {
  beforeAll(async () => {
    if (!process.env.PROXY_LIST_TOKEN) {
      throw new Error("PROXY_LIST_TOKEN is missing, set it in .env");
    }

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.argv = [process.argv[0], "index.ts", "-l", "4"];

    await ProxyService.getInstance().loadProxies();
    amazon = AmazonService.getInstance();
  });

  it("finds the buy box offer in the offers fragment", async () => {
    const results = await scrapeAll(new AmazonAodAdBuilder(), markets);
    console.info(summarize(results).join("\n"));

    const answered = answeredOf(results);
    const invalid = answered.filter((result) => !result.isValid);
    const priced = answered.filter(
      (result) => result.price! > 0 && result.dispatchFrom
    );

    expect(answered.length, "every request was blocked").toBeGreaterThan(0);
    // A response that is not a block must be the fragment we asked for
    expect(summarize(invalid), "not an offers fragment").toEqual([]);
    // Products Amazon sells everywhere have an offer in most markets
    expect(priced.length).toBeGreaterThanOrEqual(answered.length * 0.75);
  });


  it("finds products and subcategories on an amazon.pl listing", async () => {
    const builder = new AmazonPlpBuilder();
    let built: ReturnType<AmazonPlpBuilder["build"]> | undefined;

    // A listing without products counts as blocked, so it is asked again
    await scrape("pl/s?i=electronics&s=date-desc-rank", "pl/b?node=1", (d) => {
      built = builder.build(d, "electronics");
      return { isCaptcha: !built.ads.length };
    });
    console.info("pl listing:", built?.ads.length, "ads,", built?.subcategories.length, "subcategories");

    expect(built?.ads.length).toBeGreaterThan(0);
    expect(built?.ads[0]).toMatchObject({
      asin: expect.stringMatching(/^[A-Z0-9]{10}$/),
      name: expect.any(String),
      image: expect.stringMatching(/^https:\/\//),
    });
    expect(built?.subcategories.length).toBeGreaterThan(0);
  });
});
