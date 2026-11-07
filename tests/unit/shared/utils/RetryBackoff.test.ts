import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FAILED_ATTEMPTS, RetryBackoff } from "@/shared/utils/RetryBackoff";

const after = (failed: number, random = () => 1) => {
  const retry = new RetryBackoff(MAX_FAILED_ATTEMPTS, random);
  for (let i = 0; i < failed; i++) retry.fail();
  return retry;
};

describe("RetryBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("doubles the delay with every failure", () => {
    expect(after(1).delay).toBe(1000);
    expect(after(2).delay).toBe(2000);
    expect(after(3).delay).toBe(4000);
    expect(after(6).delay).toBe(32000);
  });

  it("caps the delay at 60s", () => {
    expect(after(7).delay).toBe(60000);
    expect(after(50).delay).toBe(60000);
  });

  it("randomizes the delay down to half", () => {
    expect(after(3, () => 0).delay).toBe(2000);
    expect(after(50, () => 0).delay).toBe(30000);
  });

  it("treats zero failures like the first one", () => {
    expect(after(0).delay).toBe(1000);
  });

  it("is exhausted after MAX_FAILED_ATTEMPTS failures", () => {
    expect(after(MAX_FAILED_ATTEMPTS - 1).isExhausted).toBe(false);
    expect(after(MAX_FAILED_ATTEMPTS).isExhausted).toBe(true);
  });

  it("is exhausted after its own limit of failures", () => {
    const retry = new RetryBackoff(10);
    for (let i = 0; i < 9; i++) retry.fail();
    expect(retry.isExhausted).toBe(false);

    retry.fail();
    expect(retry.isExhausted).toBe(true);
  });

  it("waits for the delay", async () => {
    const done = vi.fn();
    after(2).wait().then(done);

    await vi.advanceTimersByTimeAsync(1999);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });
});
