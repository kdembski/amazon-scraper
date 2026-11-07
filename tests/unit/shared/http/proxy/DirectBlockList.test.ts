import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";

const de = "www.amazon.de";

describe("DirectBlockList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks a route for one host for 10 minutes", () => {
    const list = new DirectBlockList();

    list.block("direct6", de);

    expect(list.isBlocked("direct6", de)).toBe(true);
    expect(list.isBlocked("direct4", de)).toBe(false);
    expect(list.isBlocked("direct6", "www.amazon.fr")).toBe(false);
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(list.isBlocked("direct6", de)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(list.isBlocked("direct6", de)).toBe(false);
  });

  it("extends the block when it comes again", () => {
    const list = new DirectBlockList();
    list.block("direct4", de);

    vi.advanceTimersByTime(5 * 60 * 1000);
    list.block("direct4", de);
    vi.advanceTimersByTime(6 * 60 * 1000);

    expect(list.isBlocked("direct4", de)).toBe(true);
  });
});
