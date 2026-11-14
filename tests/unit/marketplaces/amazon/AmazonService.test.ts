import { describe, expect, it, vi } from "vitest";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import type { ScrapingClient } from "@/shared/http/ScrapingClient";

const setup = () => {
  const client = { get: vi.fn() };
  // The constructor is private, it is only called through getInstance()
  const Service = AmazonService as unknown as new (
    ...deps: unknown[]
  ) => AmazonService;
  const service = new Service(client as unknown as ScrapingClient);
  return { service, client };
};

describe("AmazonService", () => {
  it("prefixes url and referer with https://www.amazon. and adds the country label", () => {
    const { service, client } = setup();
    const isCancelled = () => false;

    service.get("de/dp/B0TESTASIN", "de/s?k=B0TESTASIN", {
      proxyType: "isp",
      stopAt: ["a"],
      isCancelled,
    });

    expect(client.get).toHaveBeenCalledWith("https://www.amazon.de/dp/B0TESTASIN", {
      referer: "https://www.amazon.de/s?k=B0TESTASIN",
      labels: { country: "de" },
      proxyType: "isp",
      stopAt: ["a"],
      isCancelled,
      isCaptcha: expect.any(Function),
    });
  });

  it("tells captcha pages with the captcha detector", () => {
    const { service, client } = setup();

    service.get("de/x", "de/");
    const { isCaptcha } = client.get.mock.calls[0][1];

    expect(isCaptcha('<form action="/errors/validateCaptcha"></form>')).toBe(true);
    expect(isCaptcha("<html>")).toBe(false);
  });

  it("returns the promise of the scraping client", async () => {
    const { service, client } = setup();
    client.get.mockResolvedValue("<html>");

    await expect(service.get("de/x", "de/")).resolves.toBe("<html>");
  });
});
