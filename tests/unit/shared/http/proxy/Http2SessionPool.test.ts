import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Http2SessionPool } from "@/shared/http/proxy/Http2SessionPool";
import type { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
import type { ShopConnector } from "@/shared/http/proxy/ShopConnector";

const first = "http://u1:p1@1.1.1.1:8080";
const second = "http://u2:p2@2.2.2.2:8081";
const de = "www.amazon.de";

const setup = () => {
  const connector = { connect: vi.fn().mockResolvedValue({}) };
  const pool = new Http2SessionPool(
    vi.fn(),
    undefined,
    undefined,
    connector as unknown as ShopConnector
  );

  return { pool, connector };
};

const stub = (endpoint: Http2Endpoint) => {
  const idle = new Set<string>();
  const methods = {
    hasIdle: vi.spyOn(endpoint, "hasIdle").mockImplementation((host) => idle.has(host)),
    closeIdle: vi.spyOn(endpoint, "closeIdle").mockImplementation(() => {}),
    destroy: vi.spyOn(endpoint, "destroy").mockImplementation(() => {}),
  };

  return { idle, ...methods };
};

describe("Http2SessionPool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses one endpoint per proxy", () => {
    const { pool } = setup();
    const endpoint = pool.get(first);

    expect(endpoint).toBeInstanceOf(EventEmitter);
    expect(pool.get(first)).toBe(endpoint);
    expect(pool.get(second)).not.toBe(endpoint);
    expect(endpoint.route).toBe("proxy");
  });

  it("reuses one endpoint per IP family", () => {
    const { pool } = setup();

    expect(pool.getDirect(6).route).toBe("direct6");
    expect(pool.getDirect(4).route).toBe("direct4");
    expect(pool.getDirect(4)).toBe(pool.getDirect(4));
    expect(pool.getDirect(4)).not.toBe(pool.getDirect(6));
  });

  it("names the route of an endpoint", () => {
    const { pool } = setup();

    expect(pool.getRoute(pool.getDirect(6))).toBe("direct6");
    expect(pool.getRoute(pool.get(first))).toBe("proxy");
  });

  it("connects proxy endpoints through the proxy and direct ones directly", async () => {
    const { pool, connector } = setup();
    const signal = new AbortController().signal;
    const fingerprint = {} as never;

    await (pool.get(first) as any).connect(de, fingerprint, signal);
    await (pool.getDirect(6) as any).connect(de, fingerprint, signal);

    expect(connector.connect).toHaveBeenNthCalledWith(1, de, "proxy", fingerprint, signal, first);
    expect(connector.connect).toHaveBeenNthCalledWith(2, de, "direct6", fingerprint, signal);
  });

  it("gives proxies one stream and direct endpoints a hundred", () => {
    const { pool } = setup();

    expect((pool.get(first) as any).maxStreams).toBe(1);
    expect((pool.getDirect(4) as any).maxStreams).toBe(100);
  });

  it("gives proxy sessions a 256 KB stream window and direct ones Chrome's 6 MB", () => {
    const { pool } = setup();

    expect((pool.get(first) as any).fingerprints.next().settings.initialWindowSize).toBe(262144);
    expect((pool.getDirect(4) as any).fingerprints.next().settings.initialWindowSize).toBe(6291456);
  });

  describe("report", () => {
    const report = (pool: Http2SessionPool, endpoint: Http2Endpoint, ok: number, blocked: number) => {
      for (let i = 0; i < ok; i++) pool.report(endpoint, de, false);
      for (let i = 0; i < blocked; i++) pool.report(endpoint, de, true);
    };

    it("leaves proxy endpoints alone", () => {
      const { pool } = setup();
      const endpoint = pool.get(first);
      const { closeIdle } = stub(endpoint);

      report(pool, endpoint, 0, 150);

      expect(closeIdle).not.toHaveBeenCalled();
    });

    it("does not block a direct endpoint below 20% blocked responses", () => {
      const { pool } = setup();
      const direct = pool.getDirect(6);
      const { closeIdle } = stub(direct);

      report(pool, direct, 83, 17);

      expect(closeIdle).not.toHaveBeenCalled();
      expect(pool.isDirectBlocked(6, de)).toBe(false);
    });

    it("blocks a direct endpoint for the host at 20% blocked responses and closes its idle sessions", () => {
      vi.useFakeTimers();
      const { pool } = setup();
      const direct = pool.getDirect(6);
      const { closeIdle } = stub(direct);

      report(pool, direct, 80, 20);

      expect(closeIdle).toHaveBeenCalledTimes(1);
      expect(closeIdle).toHaveBeenCalledWith(de);
      expect(pool.isDirectBlocked(6, de)).toBe(true);
      expect(pool.isDirectBlocked(4, de)).toBe(false);
      expect(pool.isDirectBlocked(6, "www.amazon.fr")).toBe(false);
      vi.advanceTimersByTime(3 * 60 * 1000);
      expect(pool.isDirectBlocked(6, de)).toBe(false);
    });

    it("closes sessions of a blocked direct endpoint freed later", () => {
      const { pool } = setup();
      const direct = pool.getDirect(4);
      const { closeIdle } = stub(direct);
      report(pool, direct, 80, 20);
      closeIdle.mockClear();

      direct.emit("free", de);
      direct.emit("free", "www.amazon.fr");

      expect(closeIdle).toHaveBeenCalledTimes(1);
      expect(closeIdle).toHaveBeenCalledWith(de);
    });

    it("keeps sessions of a direct endpoint freed while it is not blocked", () => {
      const { pool } = setup();
      const direct = pool.getDirect(4);
      const { closeIdle } = stub(direct);

      direct.emit("free", de);

      expect(closeIdle).not.toHaveBeenCalled();
    });
  });

  describe("takeLastFree", () => {
    const accept = () => true;

    it("returns the proxy whose session to the host was freed last and still idles", () => {
      const { pool } = setup();
      const a = stub(pool.get(first));
      const b = stub(pool.get(second));
      a.idle.add(de);
      b.idle.add(de);
      pool.get(first).emit("free", de);
      pool.get(second).emit("free", de);

      expect(pool.takeLastFree(de, accept)).toBe(second);
      expect(pool.takeLastFree(de, accept)).toBe(first);
      expect(pool.takeLastFree(de, accept)).toBeUndefined();
    });

    it("drops proxies without an idle session", () => {
      const { pool } = setup();
      stub(pool.get(first));
      pool.get(first).emit("free", de);

      expect(pool.takeLastFree(de, accept)).toBeUndefined();
    });

    it("skips proxies the caller does not accept", () => {
      const { pool } = setup();
      stub(pool.get(first)).idle.add(de);
      pool.get(first).emit("free", de);

      expect(pool.takeLastFree(de, () => false)).toBeUndefined();
      expect(pool.takeLastFree(de, accept)).toBe(first);
    });

    it("returns undefined for a host without freed sessions", () => {
      expect(setup().pool.takeLastFree(de, accept)).toBeUndefined();
    });
  });

  describe("retain", () => {
    it("destroys endpoints of proxies that are not kept, not direct ones", () => {
      const { pool } = setup();
      const removed = pool.get(first);
      const kept = pool.get(second);
      const direct = pool.getDirect(4);
      const destroyRemoved = stub(removed).destroy;
      const destroyKept = stub(kept).destroy;
      const destroyDirect = stub(direct).destroy;

      pool.retain([second]);

      expect(destroyRemoved).toHaveBeenCalled();
      expect(destroyKept).not.toHaveBeenCalled();
      expect(destroyDirect).not.toHaveBeenCalled();
      expect(pool.get(second)).toBe(kept);
      expect(pool.get(first)).not.toBe(removed);
    });

    it("destroys every proxy endpoint with an empty list", () => {
      const { pool } = setup();
      const a = stub(pool.get(first)).destroy;
      const b = stub(pool.get(second)).destroy;

      pool.retain([]);

      expect(a).toHaveBeenCalled();
      expect(b).toHaveBeenCalled();
    });
  });

  describe("countConnections", () => {
    it("sums sessions of all endpoints", () => {
      const { pool } = setup();
      vi.spyOn(pool.get(first), "countSessions").mockReturnValue(2);
      vi.spyOn(pool.get(second), "countSessions").mockReturnValue(1);
      vi.spyOn(pool.getDirect(6), "countSessions").mockReturnValue(4);

      expect(pool.countConnections()).toBe(7);
    });

    it("returns 0 without endpoints", () => {
      expect(setup().pool.countConnections()).toBe(0);
    });
  });
});
