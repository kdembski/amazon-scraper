import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScraper } from "@/marketplaces";
import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import { ArgsService, Target } from "@/shared/args/ArgsService";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";

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

  it("loads the config, starts its refresh and the metrics reporting, then loads proxies", async () => {
    const { calls, start } = setup("pdp");

    await createScraper();

    expect(calls).toEqual(["load", "start", "metrics", "loadProxies"]);
    expect(start).toHaveBeenCalledWith("amazon");
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
