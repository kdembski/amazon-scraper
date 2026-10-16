import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestQueueService } from "@/services/RequestQueueService";

// Task that never finishes, so it keeps its pending slot
const hangingTask = () => vi.fn(() => new Promise<void>(() => {}));

const createQueue = (limit: number, rate = 0) =>
  new RequestQueueService(limit, rate, false, false, {} as any);

describe("RequestQueueService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("without rate starts tasks up to the concurrency limit", () => {
    const queue = createQueue(3);
    const tasks = Array.from({ length: 5 }, hangingTask);

    tasks.forEach((task) => queue.request(task));

    expect(tasks.filter((task) => task.mock.calls.length)).toHaveLength(3);
    expect(queue.pending).toBe(3);
    expect(queue.queue).toHaveLength(2);
  });

  it("with rate starts at most one second worth of tasks at once", () => {
    const queue = createQueue(100, 4);
    const tasks = Array.from({ length: 10 }, hangingTask);

    tasks.forEach((task) => queue.request(task));

    expect(queue.pending).toBe(4);
    expect(queue.queue).toHaveLength(6);
  });

  it("starts queued tasks as tokens refill", () => {
    const queue = createQueue(100, 4);
    Array.from({ length: 10 }, hangingTask).forEach((task) =>
      queue.request(task)
    );
    queue.start();

    vi.advanceTimersByTime(500);
    expect(queue.pending).toBe(6);

    vi.advanceTimersByTime(500);
    expect(queue.pending).toBe(8);
  });

  it("is still bound by the concurrency limit when tokens are available", () => {
    const queue = createQueue(2, 100);
    Array.from({ length: 5 }, hangingTask).forEach((task) =>
      queue.request(task)
    );

    expect(queue.pending).toBe(2);
    expect(queue.queue).toHaveLength(3);
  });

  it("does not spend tokens while the queue is empty", () => {
    const queue = createQueue(100, 4);
    queue.start();

    vi.advanceTimersByTime(100);
    expect(queue.pending).toBe(0);

    Array.from({ length: 4 }, hangingTask).forEach((task) =>
      queue.request(task)
    );
    expect(queue.pending).toBe(4);
  });
});
