import http from "node:http";
import http2 from "node:http2";
import net, { AddressInfo } from "node:net";
import tls from "node:tls";
import { generate } from "selfsigned";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Fingerprint } from "@/shared/http/http.types";
import { ShopConnector } from "@/shared/http/proxy/ShopConnector";

const fingerprint: Fingerprint = {
  chromeVersion: 140,
  headers: [],
  settings: {},
  tls: {
    ciphers: tls.DEFAULT_CIPHERS,
    sigalgs: "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256",
    ecdhCurve: "X25519:prime256v1",
  },
};

describe("ShopConnector", () => {
  let cert: { key: string; cert: string };
  let closers: (() => void)[] = [];

  beforeAll(async () => {
    const pems = await generate([{ name: "commonName", value: "localhost" }], {
      keySize: 2048,
    });
    cert = { key: pems.private, cert: pems.cert };
  });

  afterEach(() => {
    closers.forEach((close) => close());
    closers = [];
    vi.unstubAllEnvs();
  });

  const listen = async (server: net.Server) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => server.close());
    return (server.address() as AddressInfo).port;
  };

  const startH2 = () => {
    const server = http2.createSecureServer(cert);
    server.on("connection", (socket) => closers.push(() => socket.destroy()));
    return listen(server);
  };

  const startProxy = async (status: number, targetPort: number) => {
    const proxy = http.createServer();
    const auth: (string | undefined)[] = [];
    proxy.on("connect", (req, socket) => {
      closers.push(() => socket.destroy());
      auth.push(req.headers["proxy-authorization"]);
      if (status !== 200) {
        socket.end(`HTTP/1.1 ${status} Nope\r\n\r\n`);
        return;
      }
      const upstream = net.connect(targetPort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      closers.push(() => upstream.destroy());
    });
    const port = await listen(proxy);
    return { url: `http://us%40er:p%3Ass@127.0.0.1:${port}`, auth };
  };

  it("connects through a proxy with h2 and reports the raw socket", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    const proxy = await startProxy(200, await startH2());
    const onConnect = vi.fn();

    const socket = await new ShopConnector(onConnect).connect(
      "www.amazon.de",
      "proxy",
      fingerprint,
      new AbortController().signal,
      proxy.url
    );
    closers.push(() => socket.destroy());

    expect(socket.alpnProtocol).toBe("h2");
    expect(onConnect).toHaveBeenCalledTimes(1);
    const [raw, host, route] = onConnect.mock.calls[0];
    expect(raw).toBeInstanceOf(net.Socket);
    expect(raw).not.toBeInstanceOf(tls.TLSSocket);
    expect(host).toBe("www.amazon.de");
    expect(route).toBe("proxy");
    expect(proxy.auth).toEqual([
      `Basic ${Buffer.from("us@er:p:ss").toString("base64")}`,
    ]);
  });

  it("connects directly", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    const port = await startH2();
    const onConnect = vi.fn();

    const socket = await new ShopConnector(onConnect, port).connect(
      "127.0.0.1",
      "direct4",
      fingerprint,
      new AbortController().signal
    );
    closers.push(() => socket.destroy());

    expect(socket.alpnProtocol).toBe("h2");
    expect(onConnect).toHaveBeenCalledWith(
      expect.any(net.Socket),
      "127.0.0.1",
      "direct4"
    );
  });

  it("rejects with ERR_PROXY_407 when CONNECT is refused", async () => {
    const proxy = await startProxy(407, 1);

    await expect(
      new ShopConnector(vi.fn()).connect(
        "www.amazon.de",
        "proxy",
        fingerprint,
        new AbortController().signal,
        proxy.url
      )
    ).rejects.toMatchObject({ code: "ERR_PROXY_407" });
  });

  it("rejects with ERR_ALPN when the server negotiates no ALPN", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    const server = tls.createServer(cert);
    server.on("secureConnection", (socket) => {
      socket.on("error", () => {});
      closers.push(() => socket.destroy());
    });
    const proxy = await startProxy(200, await listen(server));

    await expect(
      new ShopConnector(vi.fn()).connect(
        "www.amazon.de",
        "proxy",
        fingerprint,
        new AbortController().signal,
        proxy.url
      )
    ).rejects.toMatchObject({ code: "ERR_ALPN" });
  });

  it("rejects with ETIMEDOUT when the signal is already aborted", async () => {
    const onConnect = vi.fn();

    await expect(
      new ShopConnector(onConnect).connect(
        "www.amazon.de",
        "direct4",
        fingerprint,
        AbortSignal.abort()
      )
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(onConnect).not.toHaveBeenCalled();
  });
});
