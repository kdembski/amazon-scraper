import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThrottledQueue } from "@/shared/http/ThrottledQueue";

// A callback that stays pending until finish() is called
const deferred = () => {
  let finish!: (value: string) => void;
  const promise = new Promise<string>((resolve) => (finish = resolve));
  const callback = vi.fn(() => promise);
  return { callback, finish };
};

describe("ThrottledQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the first callback at once and resolves with its result", async () => {
    const queue = new ThrottledQueue(2, 10);
    const job = deferred();

    const result = queue.request(job.callback);
    expect(job.callback).toHaveBeenCalledTimes(1);

    job.finish("ok");
    await expect(result).resolves.toBe("ok");
  });

  it("rejects with the callback error and keeps going", async () => {
    const queue = new ThrottledQueue(1, 1000);
    const next = deferred();

    await expect(queue.request(() => Promise.reject(new Error("down")))).rejects.toThrow(
      "down"
    );
    queue.request(next.callback);
    await vi.advanceTimersByTimeAsync(1);

    expect(next.callback).toHaveBeenCalledTimes(1);
  });

  it("spaces starts by 1000 / rate ms", async () => {
    const queue = new ThrottledQueue(10, 10);
    const jobs = [deferred(), deferred(), deferred()];

    jobs.forEach((job) => queue.request(job.callback));
    expect(jobs.map((job) => job.callback.mock.calls.length)).toEqual([1, 0, 0]);

    await vi.advanceTimersByTimeAsync(100);
    expect(jobs.map((job) => job.callback.mock.calls.length)).toEqual([1, 1, 0]);

    await vi.advanceTimersByTimeAsync(100);
    expect(jobs.map((job) => job.callback.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("waits for a free slot when the limit is reached", async () => {
    const queue = new ThrottledQueue(1, 1000);
    const first = deferred();
    const second = deferred();

    queue.request(first.callback);
    queue.request(second.callback);
    await vi.advanceTimersByTimeAsync(100);
    expect(second.callback).not.toHaveBeenCalled();

    first.finish("ok");
    await vi.advanceTimersByTimeAsync(1);
    expect(second.callback).toHaveBeenCalledTimes(1);
  });
});
