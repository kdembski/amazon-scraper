import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import type { Target } from "@/shared/args/args.types";
import { ArgsService } from "@/shared/args/ArgsService";
import { MetricsReporter } from "@/shared/metrics/MetricsReporter";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";

vi.mock("@/marketplaces/amazon/pdp/AmazonPdpScraper", () => ({
  AmazonPdpScraper: vi.fn(function (this: { marketplace: string }) {
    this.marketplace = "amazon";
  }),
}));

vi.mock("@/marketplaces/amazon/plp/AmazonPlpScraper", () => ({
  AmazonPlpScraper: vi.fn(function (this: { marketplace: string }) {
    this.marketplace = "amazon";
  }),
}));

const setup = (target: Target) => {
  const calls: string[] = [];
  vi.spyOn(ArgsService, "getInstance").mockReturnValue({
    getTargetFlag: () => target,
  } as unknown as ArgsService);
  vi.spyOn(TokenBucketQueue, "getInstance").mockReturnValue({
    start: vi.fn(() => calls.push("queue")),
  } as unknown as TokenBucketQueue);
  vi.spyOn(ScraperConfigService, "getInstance").mockReturnValue({
    load: vi.fn(async () => {
      calls.push("load");
    }),
    start: vi.fn(() => calls.push("start")),
  } as unknown as ScraperConfigService);
  vi.spyOn(ProxyService, "getInstance").mockReturnValue({
    loadProxies: vi.fn(async () => {
      calls.push("loadProxies");
    }),
    start: vi.fn(() => calls.push("proxyRefresh")),
  } as unknown as ProxyService);
  const start = vi.fn(() => calls.push("metrics"));
  vi.spyOn(MetricsReporter, "getInstance").mockReturnValue({
    start,
  } as unknown as MetricsReporter);
  return { calls, start };
};

describe("createScraper", () => {
  beforeEach(() => {
    vi.mocked(AmazonPdpScraper).mockClear();
    vi.mocked(AmazonPlpScraper).mockClear();
  });

  it("starts the queue, loads the config and starts its refresh, the metrics reporting, then loads proxies and starts their refresh", async () => {
    const { calls, start } = setup("pdp");

    await createScraper();

    expect(calls).toEqual(["queue", "load", "start", "metrics", "loadProxies", "proxyRefresh"]);
    expect(start).toHaveBeenCalledWith("amazon", "pdp");
  });

  it("returns the PDP scraper for pdp", async () => {
    setup("pdp");

    expect(await createScraper()).toBeInstanceOf(AmazonPdpScraper);
    expect(AmazonPlpScraper).not.toHaveBeenCalled();
  });

  it("returns the PLP scraper for plp", async () => {
    setup("plp");

    expect(await createScraper()).toBeInstanceOf(AmazonPlpScraper);
    expect(AmazonPdpScraper).not.toHaveBeenCalled();
  });
});
