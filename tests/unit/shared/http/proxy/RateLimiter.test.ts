import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/shared/http/proxy/RateLimiter";

const takeAll = (limiter: RateLimiter, count: number) =>
  Array.from({ length: count }, () => limiter.take());

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to rps takes at once", () => {
    expect(takeAll(new RateLimiter(3), 4)).toEqual([true, true, true, false]);
  });

  it("refills rps tokens per second", () => {
    const limiter = new RateLimiter(4);
    takeAll(limiter, 4);

    vi.advanceTimersByTime(500);

    expect(takeAll(limiter, 3)).toEqual([true, true, false]);
  });

  it("does not store more than rps tokens", () => {
    const limiter = new RateLimiter(2);

    vi.advanceTimersByTime(10_000);

    expect(takeAll(limiter, 3)).toEqual([true, true, false]);
  });

  it("allows nothing for 0 rps", () => {
    expect(new RateLimiter(0).take()).toBe(false);
  });
});
