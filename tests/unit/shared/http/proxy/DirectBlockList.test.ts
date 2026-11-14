import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";

const de = "www.amazon.de";

const record = (list: DirectBlockList, ok: number, blocked: number, route: "direct4" | "direct6" = "direct6") => {
  const results: boolean[] = [];
  for (let i = 0; i < ok; i++) results.push(list.record(route, de, false));
  for (let i = 0; i < blocked; i++) results.push(list.record(route, de, true));
  return results;
};

describe("DirectBlockList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not block below 20% blocked responses", () => {
    const list = new DirectBlockList();

    expect(record(list, 17, 3)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("blocks a route for one host for 3 minutes at 20% blocked responses", () => {
    const list = new DirectBlockList();

    expect(record(list, 16, 4).at(-1)).toBe(true);

    expect(list.isBlocked("direct6", de)).toBe(true);
    expect(list.isBlocked("direct4", de)).toBe(false);
    expect(list.isBlocked("direct6", "www.amazon.fr")).toBe(false);
    vi.advanceTimersByTime(3 * 60 * 1000 - 1);
    expect(list.isBlocked("direct6", de)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("does not block with fewer than 20 responses in the window", () => {
    const list = new DirectBlockList();

    expect(record(list, 0, 19)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("forgets responses older than a minute", () => {
    const list = new DirectBlockList();
    record(list, 0, 10);

    vi.advanceTimersByTime(60 * 1000);

    expect(record(list, 18, 2)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("counts again after a block and extends it", () => {
    const list = new DirectBlockList();
    record(list, 16, 4);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(record(list, 16, 3)).not.toContain(true);
    expect(list.record("direct6", de, true)).toBe(true);
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(list.isBlocked("direct6", de)).toBe(true);
  });
});
