import type http from "node:http";
import type net from "node:net";
import type { Duplex } from "node:stream";
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from "https-proxy-agent";

export class MeteredProxyAgent extends HttpsProxyAgent<string> {
  constructor(
    proxy: string,
    options: HttpsProxyAgentOptions<string>,
    private onConnect: (socket: net.Socket) => void
  ) {
    super(proxy, options);
  }

  async connect(
    req: http.ClientRequest,
    opts: Parameters<HttpsProxyAgent<string>["connect"]>[1]
  ): Promise<net.Socket> {
    const socket = (await super.connect(req, opts)) as net.Socket;
    this.onConnect((socket as { _parent?: net.Socket })._parent ?? socket);
    return socket;
  }
}
