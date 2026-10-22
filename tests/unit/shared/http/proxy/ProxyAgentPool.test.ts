import { HttpsProxyAgent } from "https-proxy-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";

const first = "http://u1:p1@1.1.1.1:8080";
const second = "http://u2:p2@2.2.2.2:8081";

describe("ProxyAgentPool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("reuses one agent per proxy", () => {
      const pool = new ProxyAgentPool(vi.fn());

      const agent = pool.get(first);

      expect(pool.get(first)).toBe(agent);
      expect(pool.get(second)).not.toBe(agent);
    });

    it("creates a metered agent for the proxy", () => {
      const agent = new ProxyAgentPool(vi.fn()).get(first);

      expect(agent).toBeInstanceOf(MeteredProxyAgent);
      expect(agent.proxy.href.replace(/\/$/, "")).toBe(first);
    });

    it("keeps connections alive", () => {
      expect(new ProxyAgentPool(vi.fn()).get(first).keepAlive).toBe(true);
    });

    it("caps idle connections and closes them after 15 s", () => {
      const agent = new ProxyAgentPool(vi.fn()).get(first);

      expect(agent.maxFreeSockets).toBe(1);
      expect(agent.options.timeout).toBe(15 * 1000);
    });

    it("passes every new connection to onConnect", async () => {
      const onConnect = vi.fn();
      const socket = { bytesRead: 0 };
      vi.spyOn(HttpsProxyAgent.prototype, "connect").mockResolvedValue(
        socket as never
      );

      await new ProxyAgentPool(onConnect)
        .get(first)
        .connect({} as never, {} as never);

      expect(onConnect).toHaveBeenCalledWith(socket);
    });
  });

  describe("hasFreeSocket", () => {
    type Pool = Record<string, unknown[]>;

    it("tells whether the proxy has an idle connection to the host", () => {
      const pool = new ProxyAgentPool(vi.fn());
      const freeSockets = pool.get(first).freeSockets as unknown as Pool;
      freeSockets["www.amazon.de:443:::::"] = [{}];
      freeSockets["www.amazon.fr:443:::::"] = [];

      expect(pool.hasFreeSocket(first, "www.amazon.de")).toBe(true);
      expect(pool.hasFreeSocket(first, "www.amazon.fr")).toBe(false);
      expect(pool.hasFreeSocket(first, "www.amazon.d")).toBe(false);
      expect(pool.hasFreeSocket(second, "www.amazon.de")).toBe(false);
    });
  });

  describe("retain", () => {
    it("destroys agents of proxies that are not kept", () => {
      const pool = new ProxyAgentPool(vi.fn());
      const removed = pool.get(first);
      const kept = pool.get(second);
      const destroyRemoved = vi.spyOn(removed, "destroy");
      const destroyKept = vi.spyOn(kept, "destroy");

      pool.retain([second, "http://u3:p3@3.3.3.3:8082"]);

      expect(destroyRemoved).toHaveBeenCalled();
      expect(destroyKept).not.toHaveBeenCalled();
      expect(pool.get(second)).toBe(kept);
      expect(pool.get(first)).not.toBe(removed);
    });
  });

  describe("countConnections", () => {
    type Pool = Record<string, unknown[]>;

    it("counts sockets in use and idle across all agents", () => {
      const pool = new ProxyAgentPool(vi.fn());
      const a = pool.get(first);
      const b = pool.get(second);

      const sockets = a.sockets as unknown as Pool;
      sockets["www.amazon.de:443"] = [{}, {}];
      sockets["www.amazon.fr:443"] = [{}];
      (a.freeSockets as unknown as Pool)["www.amazon.de:443"] = [{}];
      (b.freeSockets as unknown as Pool)["www.amazon.it:443"] = [{}];

      expect(pool.countConnections()).toBe(5);
    });

    it("returns 0 without agents", () => {
      expect(new ProxyAgentPool(vi.fn()).countConnections()).toBe(0);
    });
  });
});
