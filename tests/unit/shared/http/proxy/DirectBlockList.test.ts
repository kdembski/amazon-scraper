import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";

const de = "www.amazon.de";

const hit = (list: DirectBlockList, times: number, route: "direct4" | "direct6" = "direct6") =>
  Array.from({ length: times }, () => list.hit(route, de));

describe("DirectBlockList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not block below 5 signals", () => {
    const list = new DirectBlockList();

    expect(hit(list, 4)).toEqual([false, false, false, false]);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("blocks a route for one host for 3 minutes at the 5th signal within a minute", () => {
    const list = new DirectBlockList();

    expect(hit(list, 5)).toEqual([false, false, false, false, true]);

    expect(list.isBlocked("direct6", de)).toBe(true);
    expect(list.isBlocked("direct4", de)).toBe(false);
    expect(list.isBlocked("direct6", "www.amazon.fr")).toBe(false);
    vi.advanceTimersByTime(3 * 60 * 1000 - 1);
    expect(list.isBlocked("direct6", de)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("forgets signals older than a minute", () => {
    const list = new DirectBlockList();
    hit(list, 4);

    vi.advanceTimersByTime(60 * 1000);

    expect(list.hit("direct6", de)).toBe(false);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("counts signals again after a block and extends it", () => {
    const list = new DirectBlockList();
    hit(list, 5);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(hit(list, 5)).toEqual([false, false, false, false, true]);
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(list.isBlocked("direct6", de)).toBe(true);
  });
});
