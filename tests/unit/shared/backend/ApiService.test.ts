import http from "http";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "@/shared/backend/ApiService";
import { resetSingleton } from "@@tests/support/singleton";

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("axios", () => ({
  default: { create: vi.fn(() => client) },
}));

const create = vi.mocked(axios.create);

const setup = () => {
  resetSingleton(ApiService);
  return ApiService.getInstance();
};

describe("ApiService", () => {
  beforeEach(() => {
    vi.stubEnv("API_URL", "http://api.test");
    vi.stubEnv("API_TOKEN", "api-token");
    create.mockClear();
    client.get.mockReset();
    client.post.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a singleton", () => {
    const service = setup();
    expect(ApiService.getInstance()).toBe(service);
  });

  it("sends every request to API_URL with the token over one keep-alive agent", () => {
    setup();

    expect(create).toHaveBeenCalledTimes(1);
    const config = create.mock.calls[0][0]!;
    expect(config).toMatchObject({
      baseURL: "http://api.test",
      headers: { Authorization: "Bearer api-token" },
    });
    expect(config.httpAgent).toBeInstanceOf(http.Agent);
    expect(config.httpAgent.keepAlive).toBe(true);
  });

  describe("get", () => {
    it("returns the response data", async () => {
      const service = setup();
      client.get.mockResolvedValue({ data: { ok: true } });

      await expect(service.get("amazon/ads/scrap")).resolves.toEqual({ ok: true });
      expect(client.get).toHaveBeenCalledWith("amazon/ads/scrap", {});
    });

    it("passes the request config to axios", async () => {
      const service = setup();
      client.get.mockResolvedValue({ data: {} });

      await service.get("scrapers/it/config", { timeout: 10_000 });

      expect(client.get).toHaveBeenCalledWith("scrapers/it/config", { timeout: 10_000 });
    });

    it("throws on error", async () => {
      const service = setup();
      client.get.mockRejectedValue(new Error("down"));

      await expect(service.get("amazon/ads/scrap")).rejects.toThrow("down");
    });
  });

  describe("send", () => {
    it("posts with a 30 s timeout and returns the data", async () => {
      const service = setup();
      client.post.mockResolvedValue({ data: { count: 2 } });

      await expect(service.send("amazon/ads", [{ a: 1 }])).resolves.toEqual({ count: 2 });
      expect(client.post).toHaveBeenCalledWith("amazon/ads", [{ a: 1 }], {
        timeout: 30_000,
        headers: undefined,
      });
    });

    it("sends the idempotency key as a header", async () => {
      const service = setup();
      client.post.mockResolvedValue({ data: {} });

      await service.send("amazon/ads/batch", {}, "batch-1");

      expect(client.post).toHaveBeenCalledWith("amazon/ads/batch", {}, {
        timeout: 30_000,
        headers: { "Idempotency-Key": "batch-1" },
      });
    });

    it("throws when the request fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const service = setup();
      client.post.mockRejectedValue(new Error("down"));

      await expect(service.send("amazon/ads", [])).rejects.toThrow("down");
      expect(error).not.toHaveBeenCalled();
    });
  });
});
