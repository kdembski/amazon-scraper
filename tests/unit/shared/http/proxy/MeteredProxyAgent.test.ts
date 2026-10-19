import type net from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";

const connect = (agent: MeteredProxyAgent) =>
  agent.connect({} as never, {} as never);

describe("MeteredProxyAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the raw parent socket to onConnect and returns the tls socket", async () => {
    const raw = { bytesRead: 1 };
    const tls = { _parent: raw };
    vi.spyOn(HttpsProxyAgent.prototype, "connect").mockResolvedValue(
      tls as unknown as net.Socket
    );
    const onConnect = vi.fn();
    const agent = new MeteredProxyAgent("http://u:p@1.1.1.1:8080", {}, onConnect);

    expect(await connect(agent)).toBe(tls);
    expect(onConnect).toHaveBeenCalledWith(raw);
  });

  it("passes the socket itself when it has no parent", async () => {
    const socket = { bytesRead: 1 };
    vi.spyOn(HttpsProxyAgent.prototype, "connect").mockResolvedValue(
      socket as unknown as net.Socket
    );
    const onConnect = vi.fn();
    const agent = new MeteredProxyAgent("http://u:p@1.1.1.1:8080", {}, onConnect);

    expect(await connect(agent)).toBe(socket);
    expect(onConnect).toHaveBeenCalledWith(socket);
  });
});
