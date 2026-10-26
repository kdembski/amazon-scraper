import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
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

    it("serves https without inspecting the call stack", () => {
      const agent = new ProxyAgentPool(vi.fn()).get(first);
      const isSecureEndpoint = vi.spyOn(agent, "isSecureEndpoint");

      expect(agent.protocol).toBe("https:");
      expect(agent.defaultPort).toBe(443);
      expect(isSecureEndpoint).not.toHaveBeenCalled();
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

  describe("takeLastFree", () => {
    type Pool = Record<string, unknown[]>;
    const de = "www.amazon.de";
    const third = "http://u3:p3@3.3.3.3:8082";
    const accept = () => true;

    // Idle connection to the host, as http.Agent leaves it before our `free`
    // listener runs
    const free = (pool: ProxyAgentPool, url: string, host = de) => {
      const agent = pool.get(url);
      (agent.freeSockets as unknown as Pool)[`${host}:443:::::`] = [{}];
      agent.listeners("free").at(-1)?.({}, { host });
    };

    it("returns the proxy whose connection to the host was freed last", () => {
      const pool = new ProxyAgentPool(vi.fn());
      free(pool, first);
      free(pool, second);
      free(pool, third, "www.amazon.fr");

      expect(pool.takeLastFree(de, accept)).toBe(second);
    });

    it("moves a proxy freed again to the end", () => {
      const pool = new ProxyAgentPool(vi.fn());
      free(pool, first);
      free(pool, second);
      free(pool, first);

      expect(pool.takeLastFree(de, accept)).toBe(first);
    });

    it("takes the proxy so the next call returns the one freed before", () => {
      const pool = new ProxyAgentPool(vi.fn());
      free(pool, first);
      free(pool, second);

      expect(pool.takeLastFree(de, accept)).toBe(second);
      expect(pool.takeLastFree(de, accept)).toBe(first);
      expect(pool.takeLastFree(de, accept)).toBeUndefined();
    });

    it("drops proxies whose idle connection has closed", () => {
      const pool = new ProxyAgentPool(vi.fn());
      free(pool, first);
      free(pool, second);
      (pool.get(second).freeSockets as unknown as Pool)[`${de}:443:::::`] = [];

      expect(pool.takeLastFree(de, accept)).toBe(first);
      (pool.get(second).freeSockets as unknown as Pool)[`${de}:443:::::`] = [{}];
      expect(pool.takeLastFree(de, accept)).toBeUndefined();
    });

    it("skips proxies the caller does not accept and keeps them for later", () => {
      const pool = new ProxyAgentPool(vi.fn());
      free(pool, first);
      free(pool, second);

      expect(pool.takeLastFree(de, (url) => url === first)).toBe(first);
      expect(pool.takeLastFree(de, accept)).toBe(second);
    });

    it("returns undefined for a host without freed connections", () => {
      expect(new ProxyAgentPool(vi.fn()).takeLastFree(de, accept)).toBeUndefined();
    });

    it("learns the host from a real request whose connection is kept alive", async () => {
      const server = http.createServer((_req, res) => res.end("ok"));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const pool = new ProxyAgentPool(vi.fn());
      const agent = pool.get(first);
      vi.spyOn(agent, "connect").mockImplementation(async () =>
        net.connect(port, "127.0.0.1")
      );
      agent.protocol = "http:";

      await new Promise<void>((resolve, reject) => {
        http
          .get({ host: "localhost", port, agent }, (res) => {
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(pool.takeLastFree("localhost", accept)).toBe(first);
      pool.retain([]);
      server.close();
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
