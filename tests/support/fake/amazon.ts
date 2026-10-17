import http from "http";
import https from "https";
import { AddressInfo, Socket } from "net";
import { generate } from "selfsigned";

export type AmazonRequest = {
  country: string;
  // Url the way AmazonService gets it, starting with the TLD (de/dp/...)
  url: string;
  headers: http.IncomingHttpHeaders;
  at: number;
};

export type AmazonReply =
  | string
  | { status?: number; body?: string; delay?: number }
  | { destroy: true };

type Responder = (request: AmazonRequest) => AmazonReply;

let certificate: Promise<{ key: string; cert: string }> | undefined;

// The scraper does not verify certificates, so one self-signed for all hosts
const getCertificate = () =>
  (certificate ??= generate([{ name: "commonName", value: "www.amazon.de" }], {
    keySize: 2048,
  }).then((pems) => ({ key: pems.private, cert: pems.cert })));

// An HTTP proxy that accepts CONNECT to any www.amazon.<tld>:443, but instead
// of tunneling terminates TLS itself and answers from the responder
export class FakeAmazon {
  readonly user = "user";
  readonly password = "secret";
  requests: AmazonRequest[] = [];
  rejectedTunnels = 0;
  inFlight = 0;
  maxInFlight = 0;
  private responder: Responder = () => ({ status: 404 });
  private proxy = http.createServer((_req, res) =>
    res.writeHead(405).end()
  );
  private site!: https.Server;
  private sockets = new Set<Socket>();
  private port = 0;

  // host is how the scraper reaches this machine (host.docker.internal
  // from a container)
  constructor(private host = "127.0.0.1") {}

  async start() {
    this.site = https.createServer(await getCertificate(), (req, res) =>
      this.handle(req, res)
    );
    this.proxy.on("connect", (req, socket, head) =>
      this.tunnel(req, socket as Socket, head)
    );

    await new Promise<void>((resolve) =>
      this.proxy.listen(0, "127.0.0.1", resolve)
    );
    this.port = (this.proxy.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    this.sockets.forEach((socket) => socket.destroy());
    this.proxy.closeAllConnections();
    await new Promise((resolve) => this.proxy.close(resolve));
    this.site.close();
  }

  // Line of the webshare proxy list pointing at this proxy
  get proxyLine() {
    return `${this.host}:${this.port}:${this.user}:${this.password}`;
  }

  respond(responder: Responder) {
    this.responder = responder;
  }

  // Answers per country with the given replies in order, repeating the last
  respondPerCountry(replies: Record<string, AmazonReply[]>) {
    const counts: Record<string, number> = {};
    this.respond(({ country }) => {
      const list = replies[country];
      if (!list) return { status: 404 };

      const index = (counts[country] = (counts[country] ?? -1) + 1);
      return list[Math.min(index, list.length - 1)];
    });
  }

  requestsTo(country: string) {
    return this.requests.filter((request) => request.country === country);
  }

  private tunnel(req: http.IncomingMessage, socket: Socket, head: Buffer) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});

    const credentials = Buffer.from(`${this.user}:${this.password}`);
    const expected = `Basic ${credentials.toString("base64")}`;
    const isAmazon = /^www\.amazon\.[a-z.]+:443$/.test(req.url ?? "");

    if (req.headers["proxy-authorization"] !== expected || !isAmazon) {
      this.rejectedTunnels++;
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      return;
    }

    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);
    this.site.emit("connection", socket);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const country = (req.headers.host ?? "").replace(/^www\.amazon\./, "");
    const request: AmazonRequest = {
      country,
      url: `${country}${req.url}`,
      headers: req.headers,
      at: Date.now(),
    };
    this.requests.push(request);

    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    res.on("close", () => this.inFlight--);

    let reply = this.responder(request);
    if (typeof reply === "string") reply = { body: reply };

    if ("destroy" in reply) {
      req.socket.destroy();
      return;
    }

    const { status = 200, body = "", delay } = reply;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    res.writeHead(status, { "Content-Type": "text/html" }).end(body);
  }
}
