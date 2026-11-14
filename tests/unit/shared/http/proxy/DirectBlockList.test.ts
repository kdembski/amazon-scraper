import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";

const de = "www.amazon.de";

const record = (list: DirectBlockList, ok: number, blocked: number, route: "direct4" | "direct6" = "direct6") => {
  const results: boolean[] = [];
  for (let i = 0; i < ok; i++) results.push(list.record(route, de, "ok"));
  for (let i = 0; i < blocked; i++) results.push(list.record(route, de, "blocked"));
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

    expect(record(list, 83, 17)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("blocks a route for one host for 1 minute at 20% blocked responses", () => {
    const list = new DirectBlockList();

    expect(record(list, 80, 20).at(-1)).toBe(true);

    expect(list.isBlocked("direct6", de)).toBe(true);
    expect(list.isBlocked("direct4", de)).toBe(false);
    expect(list.isBlocked("direct6", "www.amazon.fr")).toBe(false);
    vi.advanceTimersByTime(60 * 1000 - 1);
    expect(list.isBlocked("direct6", de)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("blocks once all responses in the window are throttled or blocked", () => {
    const list = new DirectBlockList();

    for (let i = 0; i < 90; i++) list.record("direct6", de, "throttled");
    for (let i = 0; i < 9; i++) list.record("direct6", de, "blocked");

    expect(list.record("direct6", de, "throttled")).toBe(true);
    expect(list.isBlocked("direct6", de)).toBe(true);
  });

  it("does not block on throttled responses below 100%", () => {
    const list = new DirectBlockList();

    list.record("direct6", de, "ok");
    for (let i = 0; i < 150; i++) expect(list.record("direct6", de, "throttled")).toBe(false);

    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("does not block with fewer than 100 responses in the window", () => {
    const list = new DirectBlockList();

    expect(record(list, 0, 99)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("forgets responses older than a minute", () => {
    const list = new DirectBlockList();
    record(list, 0, 50);

    vi.advanceTimersByTime(60 * 1000);

    expect(record(list, 90, 10)).not.toContain(true);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("counts again after a block and extends it", () => {
    const list = new DirectBlockList();
    record(list, 80, 20);

    vi.advanceTimersByTime(40 * 1000);
    expect(record(list, 80, 19)).not.toContain(true);
    expect(list.record("direct6", de, "blocked")).toBe(true);
    vi.advanceTimersByTime(40 * 1000);

    expect(list.isBlocked("direct6", de)).toBe(true);
  });
});
