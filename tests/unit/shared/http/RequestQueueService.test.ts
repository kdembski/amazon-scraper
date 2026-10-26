import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestQueueService } from "@/shared/http/RequestQueueService";

const setup = ({ concurrency = 2, rps = 0, enableLogs = false } = {}) =>
  new RequestQueueService(concurrency, rps, enableLogs);

// A request that stays pending until finish() is called
const deferred = () => {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => (finish = resolve));
  const callback = vi.fn(() => promise);
  return { callback, finish };
};

describe("RequestQueueService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("runs a request at once while below concurrency", async () => {
      const queue = setup({ concurrency: 2 });
      const request = deferred();

      const result = queue.request(request.callback);
      expect(request.callback).toHaveBeenCalled();
      expect(queue.pending).toBe(1);

      request.finish();
      await result;
      expect(queue.pending).toBe(0);
    });

    it("returns the result of the request", async () => {
      const queue = setup();
      const callback = vi.fn(async () => "data" as unknown as void);
      await expect(queue.request(callback)).resolves.toBe("data");
    });

    it("frees the slot when a request throws", async () => {
      const queue = setup({ concurrency: 1 });
      const callback = vi.fn(async () => {
        throw new Error("boom");
      });

      await expect(queue.request(callback)).rejects.toThrow("boom");
      expect(queue.pending).toBe(0);
    });

    it("keeps running queued requests after one of them throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const queue = setup({ concurrency: 1 });
      const first = deferred();
      const failing = vi.fn(async () => {
        throw new Error("boom");
      });
      const last = deferred();
      queue.request(first.callback);
      queue.request(failing);
      queue.request(last.callback);
      queue.start();

      first.finish();
      await vi.advanceTimersByTimeAsync(5);

      expect(failing).toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(new Error("boom"));
      expect(last.callback).toHaveBeenCalled();
      expect(queue.pending).toBe(1);
    });

    it("queues requests over concurrency", () => {
      const queue = setup({ concurrency: 1 });
      const first = deferred();
      const second = deferred();

      queue.request(first.callback);
      queue.request(second.callback);

      expect(second.callback).not.toHaveBeenCalled();
      expect(queue.queue).toEqual([second.callback]);
      expect(queue.pending).toBe(1);
    });

  });

  describe("start", () => {
    it("runs queued requests when slots free up", async () => {
      const queue = setup({ concurrency: 1 });
      const first = deferred();
      const second = deferred();
      queue.request(first.callback);
      queue.request(second.callback);
      queue.start();

      await vi.advanceTimersByTimeAsync(5);
      expect(second.callback).not.toHaveBeenCalled();

      first.finish();
      await vi.advanceTimersByTimeAsync(5);
      expect(second.callback).toHaveBeenCalled();
      expect(queue.queue).toEqual([]);
      expect(queue.pending).toBe(1);
    });

    it("runs a queued request as soon as a slot frees up, without waiting for a tick", async () => {
      const queue = setup({ concurrency: 1 });
      const first = deferred();
      const second = deferred();
      queue.request(first.callback);
      queue.request(second.callback);

      first.finish();
      await Promise.resolve();
      await Promise.resolve();

      expect(second.callback).toHaveBeenCalled();
      expect(queue.queue).toEqual([]);
      expect(queue.pending).toBe(1);
    });

    it("lowering concurrency holds new requests until pending drops below it", async () => {
      const queue = setup({ concurrency: 3 });
      const running = Array.from({ length: 3 }, () => deferred());
      running.forEach((request) => queue.request(request.callback));
      queue.concurrency = 1;
      const next = deferred();
      queue.request(next.callback);

      running[0].finish();
      running[1].finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(next.callback).not.toHaveBeenCalled();

      running[2].finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(next.callback).toHaveBeenCalled();
    });

    it("starts at most 10 queued requests per tick", async () => {
      const queue = setup({ concurrency: 100 });
      queue.concurrency = 0;
      const requests = Array.from({ length: 15 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));
      queue.concurrency = 100;

      queue.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(queue.pending).toBe(10);

      await vi.advanceTimersByTimeAsync(1);
      expect(queue.pending).toBe(15);
    });

    it("does not try to start requests on a tick while no slot is free", async () => {
      const queue = setup({ concurrency: 1 });
      queue.request(deferred().callback);
      queue.request(deferred().callback);
      const next = vi.spyOn(queue as unknown as { next: () => void }, "next");

      queue.start();
      await vi.advanceTimersByTimeAsync(10);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("rps limit", () => {
    it("is unlimited when rps is 0", () => {
      const queue = setup({ concurrency: 100, rps: 0 });
      const requests = Array.from({ length: 50 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(50);
    });

    it("starts at most `rps` requests at once", () => {
      const queue = setup({ concurrency: 100, rps: 3 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(3);
      expect(queue.queue).toHaveLength(2);
    });

    it("refills tokens over time", async () => {
      const queue = setup({ concurrency: 100, rps: 2 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));
      queue.start();

      await vi.advanceTimersByTimeAsync(490);
      expect(queue.pending).toBe(2);

      await vi.advanceTimersByTimeAsync(20);
      expect(queue.pending).toBe(3);

      await vi.advanceTimersByTimeAsync(1000);
      expect(queue.pending).toBe(5);
    });

    it("is still bound by concurrency when tokens are available", () => {
      const queue = setup({ concurrency: 2, rps: 100 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(2);
      expect(queue.queue).toHaveLength(3);
    });

    it("does not spend tokens while the queue is empty", async () => {
      const queue = setup({ concurrency: 100, rps: 4 });
      queue.start();
      await vi.advanceTimersByTimeAsync(100);

      const requests = Array.from({ length: 4 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(4);
    });

    it("setRps from 0 starts at most the new rps in the first second", async () => {
      const queue = setup({ concurrency: 100, rps: 0 });
      queue.setRps(2);
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));
      queue.start();

      await vi.advanceTimersByTimeAsync(999);
      expect(queue.rps).toBe(2);
      expect(queue.pending).toBeLessThanOrEqual(2);

      await vi.advanceTimersByTimeAsync(1000);
      expect(queue.pending).toBe(3);
    });

    it("setRps to a higher rps does not refill a drained bucket", () => {
      const queue = setup({ concurrency: 100, rps: 2 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));
      queue.setRps(5);
      queue.request(deferred().callback);

      expect(queue.pending).toBe(2);
    });

    it("setRps to a lower rps starts at most the new rps at once", () => {
      const queue = setup({ concurrency: 100, rps: 5 });
      queue.setRps(2);
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(2);
    });

    it("holds at most one second worth of tokens", async () => {
      const queue = setup({ concurrency: 100, rps: 2 });
      await vi.advanceTimersByTimeAsync(10_000);

      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(2);
    });
  });

  describe("logs", () => {
    it("logs the state every second when enabled", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      setup({ concurrency: 5, rps: 3, enableLogs: true });

      await vi.advanceTimersByTimeAsync(1000);

      expect(log).toHaveBeenCalledWith("rps: 3/s | concurrency: 5 | pending: 0 | queue: 0");
    });

    it("logs open connections after pending when they are counted", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      new RequestQueueService(5, 3, true, () => 42);

      await vi.advanceTimersByTimeAsync(1000);

      expect(log.mock.calls[0][0]).toContain("pending: 0 | connections: 42 | queue: 0");
    });

    it("shows a dash when rps is unlimited", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      setup({ enableLogs: true });

      await vi.advanceTimersByTimeAsync(1000);

      expect(log.mock.calls[0][0]).toContain("rps: -/s");
    });

    it("does not log by default", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      setup();
      await vi.advanceTimersByTimeAsync(1000);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
