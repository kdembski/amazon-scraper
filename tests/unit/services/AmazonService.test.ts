import { describe, expect, it, vi } from "vitest";
import { AmazonService } from "@/services/AmazonService";
import type { ScrapingClient } from "@/shared/http/ScrapingClient";

const setup = () => {
  const queueService = { pending: 0 };
  const client = { get: vi.fn(), queueService };
  // The constructor is private, it is only called through getInstance()
  const Service = AmazonService as unknown as new (
    ...deps: unknown[]
  ) => AmazonService;
  const service = new Service(client as unknown as ScrapingClient);
  return { service, client, queueService };
};

describe("AmazonService", () => {
  it("prefixes url and referer with https://www.amazon. and delegates to the scraping client", () => {
    const { service, client } = setup();
    const callback = { onSuccess: vi.fn() };

    service.get("de/dp/B0TESTASIN", "de/s?k=B0TESTASIN", callback);

    expect(client.get).toHaveBeenCalledWith(
      "https://www.amazon.de/dp/B0TESTASIN",
      "https://www.amazon.de/s?k=B0TESTASIN",
      callback
    );
  });

  it("exposes the scraping client queue", () => {
    const { service, queueService } = setup();
    expect(service.queueService).toBe(queueService);
  });
});
