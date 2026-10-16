import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestQueueService } from "@/services/RequestQueueService";
import type { RequestQueueRegulator } from "@/services/RequestQueueRegulator";

const fakeRegulator = (scrapersCount?: number, targetedGlobalCpu = 50) => {
  const start = vi.fn();
  const regulator = {
    start,
    scrapersCount,
    targetedGlobalCpu,
  } as unknown as RequestQueueRegulator;
  return { regulator, start };
};

const setup = ({
  limit = 2,
  rate = 0,
  enableLogs = false,
  enableRegulation = false,
  regulator = fakeRegulator().regulator,
} = {}) =>
  new RequestQueueService(limit, rate, enableLogs, enableRegulation, regulator);

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
    it("runs a request at once while below the limit", async () => {
      const queue = setup({ limit: 2 });
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
      const queue = setup({ limit: 1 });
      const callback = vi.fn(async () => {
        throw new Error("boom");
      });

      await expect(queue.request(callback)).rejects.toThrow("boom");
      expect(queue.pending).toBe(0);
    });

    it("keeps running queued requests after one of them throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const queue = setup({ limit: 1 });
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

    it("queues requests over the limit", () => {
      const queue = setup({ limit: 1 });
      const first = deferred();
      const second = deferred();

      queue.request(first.callback);
      queue.request(second.callback);

      expect(second.callback).not.toHaveBeenCalled();
      expect(queue.queue).toEqual([second.callback]);
      expect(queue.pending).toBe(1);
    });

    it("puts requests marked as top at the front of the queue", () => {
      const queue = setup({ limit: 1 });
      const [first, second, third] = [deferred(), deferred(), deferred()];

      queue.request(first.callback);
      queue.request(second.callback);
      queue.request(third.callback, true);

      expect(queue.queue).toEqual([third.callback, second.callback]);
    });
  });

  describe("start", () => {
    it("runs queued requests when slots free up", async () => {
      const queue = setup({ limit: 1 });
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

    it("starts at most 10 queued requests per tick", async () => {
      const queue = setup({ limit: 100 });
      queue.limit = 0;
      const requests = Array.from({ length: 15 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));
      queue.limit = 100;

      queue.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(queue.pending).toBe(10);

      await vi.advanceTimersByTimeAsync(1);
      expect(queue.pending).toBe(15);
    });
  });

  describe("rate limit", () => {
    it("is unlimited when rate is 0", () => {
      const queue = setup({ limit: 100, rate: 0 });
      const requests = Array.from({ length: 50 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(50);
    });

    it("starts at most `rate` requests at once", () => {
      const queue = setup({ limit: 100, rate: 3 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(3);
      expect(queue.queue).toHaveLength(2);
    });

    it("refills tokens over time", async () => {
      const queue = setup({ limit: 100, rate: 2 });
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

    it("is still bound by the concurrency limit when tokens are available", () => {
      const queue = setup({ limit: 2, rate: 100 });
      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(2);
      expect(queue.queue).toHaveLength(3);
    });

    it("does not spend tokens while the queue is empty", async () => {
      const queue = setup({ limit: 100, rate: 4 });
      queue.start();
      await vi.advanceTimersByTimeAsync(100);

      const requests = Array.from({ length: 4 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(4);
    });

    it("holds at most one second worth of tokens", async () => {
      const queue = setup({ limit: 100, rate: 2 });
      await vi.advanceTimersByTimeAsync(10_000);

      const requests = Array.from({ length: 5 }, () => deferred());
      requests.forEach((request) => queue.request(request.callback));

      expect(queue.pending).toBe(2);
    });
  });

  describe("speed", () => {
    it("is the average of completed requests per second", async () => {
      const queue = setup();

      queue.completed = 4;
      await vi.advanceTimersByTimeAsync(1000);
      expect(queue.speed).toBe(4);

      queue.completed = 6;
      await vi.advanceTimersByTimeAsync(1000);
      expect(queue.speed).toBe(3);
    });

    it("ignores the counter being reset", async () => {
      const queue = setup();

      queue.completed = 4;
      await vi.advanceTimersByTimeAsync(1000);
      queue.completed = 0;
      await vi.advanceTimersByTimeAsync(1000);

      expect(queue.speed).toBe(2);
      expect(queue.previousCompleted).toBe(0);
    });
  });

  describe("regulation", () => {
    it("starts the regulator when enabled", () => {
      const { regulator, start } = fakeRegulator();
      setup({ enableRegulation: true, regulator });
      expect(start).toHaveBeenCalled();
    });

    it("does not start the regulator by default", () => {
      const { regulator, start } = fakeRegulator();
      setup({ regulator });
      expect(start).not.toHaveBeenCalled();
    });
  });

  describe("logs", () => {
    it("logs the state every second when enabled", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const queue = setup({ limit: 5, rate: 3, enableLogs: true });
      queue.failed = 2;
      queue.completed = 7;

      await vi.advanceTimersByTimeAsync(1000);

      expect(log).toHaveBeenCalledWith(
        "speed: 7.00/s | tcpu: -% | limit: 5 | rate: 3/s | pending: 0 | queue: 0 | failed: 2 | completed: 7"
      );
    });

    it("shows the targeted cpu of this scraper", async () => {
      vi.spyOn(os, "cpus").mockReturnValue(new Array(4));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { regulator } = fakeRegulator(2, 50);
      setup({ enableLogs: true, regulator });

      await vi.advanceTimersByTimeAsync(1000);

      expect(log.mock.calls[0][0]).toContain("tcpu: 100%");
      expect(log.mock.calls[0][0]).toContain("rate: -/s");
    });

    it("does not log by default", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      setup();
      await vi.advanceTimersByTimeAsync(1000);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
