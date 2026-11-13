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
    let secure: tls.TLSSocket | undefined;
    let onAbort!: () => void;

    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        raw?.destroy();
        secure?.destroy();
        reject(fail("Connect aborted", "ETIMEDOUT"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    const establish = async () => {
      raw = await this.open(host, route, proxyUrl, (socket) => (raw = socket));
      this.onConnect(raw, host, route);

      secure = tls.connect({
        socket: raw,
        servername: host,
        ALPNProtocols: ["h2"],
        ...fingerprint.tls,
      });
      await new Promise<void>((resolve, reject) => {
        secure!.once("secureConnect", resolve);
        secure!.once("error", reject);
      });
      if (secure.alpnProtocol === "h2") return secure;

      secure.destroy();
      throw fail(`ALPN ${secure.alpnProtocol}`, "ERR_ALPN");
    };

    try {
      return await Promise.race([establish(), aborted]);
    } catch (error) {
      raw?.destroy();
      secure?.destroy();
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
    track: (socket: net.Socket) => void
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
        socket.once("error", reject);
      });
    }

    const url = new URL(proxyUrl);
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;

    return new Promise<net.Socket>((resolve, reject) => {
      const request = http.request({
        host: url.hostname,
        port: url.port,
        method: "CONNECT",
        path: `${host}:${this.port}`,
        headers: {
          "Proxy-Authorization": `Basic ${Buffer.from(credentials).toString("base64")}`,
        },
      });
      request.once("connect", (response, socket) => {
        track(socket);
        if (response.statusCode === 200) return resolve(socket);

        socket.destroy();
        reject(
          fail(`Proxy ${response.statusCode}`, `ERR_PROXY_${response.statusCode}`)
        );
      });
      request.once("error", reject);
      request.end();
    });
  }
}
