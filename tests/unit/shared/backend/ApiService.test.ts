import http from "http";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "@/shared/backend/ApiService";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = {
  get: vi.mocked(axios.get),
  post: vi.mocked(axios.post),
  put: vi.mocked(axios.put),
  delete: vi.mocked(axios.delete),
};

const setup = () => {
  resetSingleton(ApiService);
  return ApiService.getInstance();
};

const withAgent = {
  headers: { Authorization: "Bearer api-token" },
  httpAgent: expect.any(http.Agent),
};

describe("ApiService", () => {
  beforeEach(() => {
    vi.stubEnv("API_URL", "http://api.test");
    vi.stubEnv("API_TOKEN", "api-token");
    Object.values(mocked).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a singleton", () => {
    const service = setup();
    expect(ApiService.getInstance()).toBe(service);
  });

  describe("get", () => {
    it("returns the response data", async () => {
      const service = setup();
      mocked.get.mockResolvedValue({ data: { ok: true } });

      await expect(service.get("amazon/ads/scrap")).resolves.toEqual({ ok: true });
      expect(mocked.get).toHaveBeenCalledWith(
        "http://api.test/amazon/ads/scrap",
        withAgent
      );
    });

    it("passes the request config to axios", async () => {
      const service = setup();
      mocked.get.mockResolvedValue({ data: {} });

      await service.get("scrapers/it/config", { timeout: 10_000 });

      expect(mocked.get).toHaveBeenCalledWith(
        "http://api.test/scrapers/it/config",
        expect.objectContaining({ timeout: 10_000, httpAgent: expect.anything() })
      );
    });

    it("keeps Authorization when the config has headers", async () => {
      const service = setup();
      mocked.get.mockResolvedValue({ data: {} });

      await service.get("a", { headers: { "X-A": "1" } });

      expect(mocked.get).toHaveBeenCalledWith(
        "http://api.test/a",
        expect.objectContaining({
          headers: { "X-A": "1", Authorization: "Bearer api-token" },
        })
      );
    });

    it("throws on error", async () => {
      const service = setup();
      mocked.get.mockRejectedValue(new Error("down"));

      await expect(service.get("amazon/ads/scrap")).rejects.toThrow("down");
    });
  });

  describe("send", () => {
    it("posts with the token and returns the data", async () => {
      const service = setup();
      mocked.post.mockResolvedValue({ data: { count: 2 } });

      await expect(service.send("amazon/ads", [{ a: 1 }])).resolves.toEqual({ count: 2 });
      expect(mocked.post).toHaveBeenCalledWith(
        "http://api.test/amazon/ads",
        [{ a: 1 }],
        withAgent
      );
    });

    it("throws when the request fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const service = setup();
      mocked.post.mockRejectedValue(new Error("down"));

      await expect(service.send("amazon/ads", [])).rejects.toThrow("down");
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["post", (s: ApiService) => s.post("amazon/ads", { a: 1 }), [{ a: 1 }]],
    ["put", (s: ApiService) => s.put("amazon/ads/1", { a: 1 }), [{ a: 1 }]],
    ["delete", (s: ApiService) => s.delete("amazon/ads/1"), []],
  ] as const)("%s", (method, call, body) => {
    const path = method === "post" ? "amazon/ads" : "amazon/ads/1";

    it("sends the request", async () => {
      const service = setup();
      mocked[method].mockResolvedValue({ data: "ok" });

      await call(service);
      expect(mocked[method]).toHaveBeenCalledWith(
        `http://api.test/${path}`,
        ...body,
        withAgent
      );
    });

    it("logs errors instead of throwing", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const service = setup();
      mocked[method].mockRejectedValue({
        status: 500,
        message: "Request failed",
        cause: new Error("socket hang up"),
        response: { data: "line 1\nline 2" },
      });

      await expect(call(service)).resolves.toBeUndefined();
      expect(error.mock.calls.map((args) => args[0])).toEqual([
        "Server:",
        "  500",
        "  Request failed",
        "  Error: socket hang up",
        "  line 1 line 2",
      ]);
    });
  });

  describe.each([
    ["put", (s: ApiService) => s.put("amazon/ads/1", {})],
    ["delete", (s: ApiService) => s.delete("amazon/ads/1")],
  ] as const)("%s throttling", (method, call) => {
    it("sends at most 25 requests per second", async () => {
      vi.useFakeTimers();
      const service = setup();
      mocked[method].mockResolvedValue({ data: "ok" });

      call(service);
      call(service);
      expect(mocked[method]).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(40);
      expect(mocked[method]).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  it("reuses one keep-alive agent for every request", async () => {
    const service = setup();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: "ok" });
    mocked.put.mockResolvedValue({ data: "ok" });
    mocked.delete.mockResolvedValue({ data: "ok" });

    await service.get("a");
    await service.post("a", {});
    await service.put("a", {});
    await service.delete("a");

    const agents = [
      mocked.get.mock.calls[0][1]?.httpAgent,
      mocked.post.mock.calls[0][2]?.httpAgent,
      mocked.put.mock.calls[0][2]?.httpAgent,
      mocked.delete.mock.calls[0][1]?.httpAgent,
    ];
    expect(new Set(agents).size).toBe(1);
    expect(agents[0].keepAlive).toBe(true);
  });

  describe("post config", () => {
    it("forwards the extra config together with the agent", async () => {
      const service = setup();
      mocked.post.mockResolvedValue({ data: "ok" });

      await service.post("amazon/ads", { a: 1 }, { timeout: 5000 });
      expect(mocked.post).toHaveBeenCalledWith(
        "http://api.test/amazon/ads",
        { a: 1 },
        { ...withAgent, timeout: 5000 }
      );
    });

    it("calls axios with only the agent without config", async () => {
      const service = setup();
      mocked.post.mockResolvedValue({ data: "ok" });

      await service.post("amazon/ads", { a: 1 });
      expect(mocked.post).toHaveBeenCalledWith(
        "http://api.test/amazon/ads",
        { a: 1 },
        withAgent
      );
    });
  });
});
