import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchSender } from "@/shared/backend/BatchSender";
import type { ApiService } from "@/shared/backend/ApiService";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";

const setup = ({ maxSize = 10 } = {}) => {
  const send = vi.fn().mockResolvedValue(undefined);
  const increment = vi.fn();
  const gauge = vi.fn();
  const sender = new BatchSender<number>(
    "amazon/ads",
    (items) => ({ items }),
    maxSize,
    5000,
    { send } as unknown as ApiService,
    { increment, gauge } as unknown as MetricsService
  );
  return { sender, send, increment, gauge };
};

const withoutKey = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([path, body]) => [path, body]);
const keys = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([, , key]) => key);

const calls = (increment: ReturnType<typeof vi.fn>, metric: string) =>
  increment.mock.calls.filter(([name]) => name === metric);

const networkError = () => new Error("socket hang up");
const httpError = (status: number) => Object.assign(new Error("failed"), { response: { status } });

describe("BatchSender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends nothing before the interval and everything buffered after it", async () => {
    const { sender, send } = setup();

    [1, 2, 3].forEach((item) => sender.add(item));
    await vi.advanceTimersByTimeAsync(4999);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(withoutKey(send)).toEqual([["amazon/ads", { items: [1, 2, 3] }]]);
  });

  it("flushes at once when the buffer reaches maxSize", async () => {
    const { sender, send } = setup({ maxSize: 2 });

    sender.add(1);
    sender.add(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(withoutKey(send)).toEqual([["amazon/ads", { items: [1, 2] }]]);
  });

  it("does not start a timer while the buffer is empty", async () => {
    const { sender, send } = setup();
    expect(vi.getTimerCount()).toBe(0);

    sender.add(1);
    await vi.advanceTimersByTimeAsync(5000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one flush in flight and sends items added meanwhile in the next one", async () => {
    const { sender, send } = setup({ maxSize: 2 });
    let finish!: () => void;
    send.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));

    sender.add(1);
    sender.add(2);
    sender.add(3);
    sender.add(4);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(withoutKey(send)).toEqual([
      ["amazon/ads", { items: [1, 2] }],
      ["amazon/ads", { items: [3, 4] }],
    ]);
  });

  it("sends at most maxSize items per request and the rest right after", async () => {
    const { sender, send } = setup({ maxSize: 2 });
    let finish!: () => void;
    send.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));

    [1, 2, 3, 4, 5].forEach((item) => sender.add(item));
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.map(([, body]) => body.items)).toEqual([[1, 2], [3, 4]]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls.map(([, body]) => body.items)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("retries a network error and a 500 until it succeeds", async () => {
    const { sender, send, increment } = setup();
    send.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(httpError(500));

    [1, 2, 3].forEach((item) => sender.add(item));
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(withoutKey(send)).toEqual([
      ["amazon/ads", { items: [1, 2, 3] }],
      ["amazon/ads", { items: [1, 2, 3] }],
      ["amazon/ads", { items: [1, 2, 3] }],
    ]);
    expect(calls(increment, "backend_items")).toEqual([["backend_items", { outcome: "sent" }, 3]]);
  });

  it("drops the batch after MAX_FAILED_ATTEMPTS failures and keeps sending later items", async () => {
    const { sender, send, increment } = setup();
    send.mockRejectedValue(httpError(503));

    sender.add(1);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(send).toHaveBeenCalledTimes(MAX_FAILED_ATTEMPTS);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(calls(increment, "backend_items")).toEqual([["backend_items", { outcome: "dropped" }, 1]]);

    send.mockResolvedValue(undefined);
    sender.add(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenLastCalledWith("amazon/ads", { items: [2] }, expect.any(String));
  });

  it("sends one idempotency key for every attempt of a batch and a new one for the next batch", async () => {
    const { sender, send } = setup();
    send.mockRejectedValueOnce(networkError());

    sender.add(1);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    sender.add(2);
    await vi.advanceTimersByTimeAsync(5000);

    const [first, retry, next] = keys(send);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry).toBe(first);
    expect(next).not.toBe(first);
  });

  it("drops the batch on a 4xx without retrying", async () => {
    const { sender, send, increment } = setup();
    send.mockRejectedValue(httpError(413));

    sender.add(1);
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(calls(increment, "backend_items")).toEqual([["backend_items", { outcome: "dropped" }, 1]]);
  });

  it("counts every attempt by outcome with its duration", async () => {
    const { sender, send, increment } = setup();
    const timeout = (code: string) => Object.assign(new Error("timeout"), { code });
    send
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(timeout("ECONNABORTED"))
      .mockRejectedValueOnce(timeout("ETIMEDOUT"))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        throw httpError(502);
      });

    sender.add(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(calls(increment, "backend_requests").map(([, labels]) => labels.outcome)).toEqual([
      "network",
      "timeout",
      "timeout",
      "http_502",
      "ok",
    ]);
    expect(calls(increment, "backend_send_ms").map(([, , ms]) => ms)).toEqual([0, 0, 0, 250, 0]);
  });

  it("reports the length of its buffer as backend_buffer", async () => {
    const { sender, gauge } = setup();
    const [[metric, read]] = gauge.mock.calls;

    sender.add(1);
    sender.add(2);
    expect([metric, read()]).toEqual(["backend_buffer", 2]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(read()).toBe(0);
  });
});
