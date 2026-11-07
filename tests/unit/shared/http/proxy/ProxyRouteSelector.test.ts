import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyRouteSelector } from "@/shared/http/proxy/ProxyRouteSelector";

const pl = "www.amazon.pl";
const minute = 60 * 1000;

const setup = (families: (4 | 6)[] = [4]) => {
  const pool = {
    getDirect: vi.fn((family: 4 | 6) => ({ direct: family })),
    isDirectBlocked: vi.fn((_family: 4 | 6, _host: string) => false),
  };
  const selector = new ProxyRouteSelector(pool as unknown as ProxyAgentPool);
  selector.directFamilies = families;
  return { selector, pool };
};

describe("ProxyRouteSelector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives no direct agent for a proxy pool", () => {
    const { selector } = setup();

    expect(selector.getDirect(pl, "datacenter")).toBeUndefined();
  });

  it("goes over the IP families in turn", () => {
    const { selector } = setup([4, 6]);

    const agents = [1, 2, 3].map(() => selector.getDirect(pl, "direct"));

    expect(agents).toEqual([{ direct: 4 }, { direct: 6 }, { direct: 4 }]);
  });

  it("skips a family blocked by the host", () => {
    const { selector, pool } = setup([4, 6]);
    pool.isDirectBlocked.mockImplementation((family, host) => family === 6 && host === pl);

    expect(selector.getDirect(pl, "direct")).toEqual({ direct: 4 });
    expect(selector.getDirect(pl, "direct")).toEqual({ direct: 4 });
  });

  it("gives no direct agent while every family is blocked", () => {
    const { selector, pool } = setup();
    pool.isDirectBlocked.mockReturnValue(true);

    expect(selector.getDirect(pl, "direct")).toBeUndefined();
  });

  it.each([
    ["mixed2", [true, true, false, false, true]],
    ["mixed1/2", [true, false, false, true, false]],
  ])("follows the wall clock windows of %s", (proxyType, windows) => {
    const { selector } = setup();

    const direct = windows.map((_, m) => {
      vi.setSystemTime(m * minute);
      return !!selector.getDirect(pl, proxyType);
    });

    expect(direct).toEqual(windows);
  });

  it.each(["mixed", "mixed0", "mixed0/2", "mixed1/"])("treats %s as no direct window", (proxyType) => {
    const { selector } = setup();
    vi.setSystemTime(0);

    expect(selector.getDirect(pl, proxyType)).toBeUndefined();
  });
});
