import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import type { Fingerprint, Route } from "@/shared/http/http.types";

const fail = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

export class ShopConnector {
  constructor(
    private onConnect: (socket: net.Socket, host: string, route: Route) => void,
    private port = 443
  ) {}

  async connect(
    host: string,
    route: Route,
    fingerprint: Fingerprint,
    signal: AbortSignal,
    proxyUrl?: string
  ): Promise<tls.TLSSocket> {
    if (signal.aborted) throw fail("Connect aborted", "ETIMEDOUT");

    let raw: net.Socket | undefined;
    let request: http.ClientRequest | undefined;
    let secure: tls.TLSSocket | undefined;
    let onAbort!: () => void;

    const destroyAll = () => {
      secure?.destroy();
      raw?.destroy();
      request?.destroy();
    };

    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        destroyAll();
        reject(fail("Connect aborted", "ETIMEDOUT"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    const establish = async () => {
      raw = await this.open(
        host,
        route,
        proxyUrl,
        (socket) => (raw = socket),
        (pending) => (request = pending)
      );
      if (signal.aborted) throw fail("Connect aborted", "ETIMEDOUT");

      this.onConnect(raw, host, route);

      secure = tls.connect({
        socket: raw,
        servername: host,
        ALPNProtocols: ["h2"],
        ...fingerprint.tls,
      });
      await new Promise<void>((resolve, reject) => {
        secure!.once("secureConnect", resolve);
        secure!.on("error", reject);
      });
      if (secure.alpnProtocol === "h2") return secure;

      throw fail(`ALPN ${secure.alpnProtocol}`, "ERR_ALPN");
    };

    try {
      return await Promise.race([establish(), aborted]);
    } catch (error) {
      destroyAll();
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
      aborted.catch(() => {});
    }
  }

  private open(
    host: string,
    route: Route,
    proxyUrl: string | undefined,
    track: (socket: net.Socket) => void,
    trackRequest: (request: http.ClientRequest) => void
  ) {
    if (!proxyUrl) {
      return new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect({
          host,
          port: this.port,
          family: route === "direct6" ? 6 : 4,
        });
        track(socket);
        socket.once("connect", () => resolve(socket));
        socket.on("error", reject);
      });
    }

    const url = new URL(proxyUrl);
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    const headers = url.username
      ? {
          "Proxy-Authorization": `Basic ${Buffer.from(credentials).toString("base64")}`,
        }
      : {};

    return new Promise<net.Socket>((resolve, reject) => {
      const request = http.request({
        host: url.hostname,
        port: url.port,
        method: "CONNECT",
        path: `${host}:${this.port}`,
        headers,
      });
      trackRequest(request);
      request.once("connect", (response, socket) => {
        track(socket);
        socket.on("error", reject);
        if (response.statusCode === 200) return resolve(socket);

        socket.destroy();
        reject(
          fail(`Proxy ${response.statusCode}`, `ERR_PROXY_${response.statusCode}`)
        );
      });
      request.on("error", reject);
      request.end();
    });
  }
}
