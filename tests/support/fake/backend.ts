import http from "http";
import { EventEmitter } from "events";
import { AddressInfo } from "net";

export type BackendRequest = {
  method: string;
  // Path without the leading slash, as ApiService gets it (amazon/ads/1)
  path: string;
  query: URLSearchParams;
  body: any;
  headers: http.IncomingHttpHeaders;
};

export type BackendReply = { status?: number; body?: unknown };
type Route = (request: BackendRequest) => BackendReply;

// Stands in for the backend behind API_URL: answers from a route table and
// records every request
export class FakeBackend {
  requests: BackendRequest[] = [];
  url = "";
  private routes = new Map<string, Route>();
  private events = new EventEmitter();
  private server = http.createServer((req, res) => this.handle(req, res));

  // host is how the scraper reaches this machine (host.docker.internal
  // from a container)
  constructor(private host = "127.0.0.1") {}

  async start() {
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://${this.host}:${port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  // Body for every request to the route, or a function building the reply
  on(method: string, path: string, reply: Route | unknown) {
    const route =
      typeof reply === "function"
        ? (reply as Route)
        : () => ({ body: reply });
    this.routes.set(`${method} ${path}`, route);
    return this;
  }

  // Answers with the given replies in order, repeating the last one
  onSequence(method: string, path: string, replies: BackendReply[]) {
    let index = 0;
    return this.on(method, path, () =>
      replies[Math.min(index++, replies.length - 1)]
    );
  }

  find(method: string, path: string) {
    return this.requests.filter(
      (request) => request.method === method && request.path === path
    );
  }

  waitFor(method: string, path: string, timeout = 10 * 1000) {
    return new Promise<BackendRequest>((resolve, reject) => {
      const found = this.find(method, path)[0];
      if (found) return resolve(found);

      const timer = setTimeout(() => {
        this.events.off("request", listener);
        const received = this.requests.map((r) => `${r.method} ${r.path}`);
        reject(
          new Error(
            `No ${method} ${path} within ${timeout} ms, received: ${received.join(", ")}`
          )
        );
      }, timeout);

      const listener = (request: BackendRequest) => {
        if (request.method !== method || request.path !== path) return;
        clearTimeout(timer);
        this.events.off("request", listener);
        resolve(request);
      };
      this.events.on("request", listener);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();

    const url = new URL(req.url!, this.url);
    const request: BackendRequest = {
      method: req.method!,
      path: url.pathname.slice(1),
      query: url.searchParams,
      body: raw ? JSON.parse(raw) : undefined,
      headers: req.headers,
    };

    const route = this.routes.get(`${request.method} ${request.path}`);
    // Writes succeed by default, reads of unknown data do not
    const reply = route
      ? route(request)
      : { status: request.method === "GET" ? 404 : 200 };

    this.requests.push(request);
    this.events.emit("request", request);

    const { status = 200, body } = reply;
    if (typeof body === "string") {
      res.writeHead(status, { "Content-Type": "text/plain" }).end(body);
      return;
    }

    res
      .writeHead(status, { "Content-Type": "application/json" })
      .end(body === undefined ? "" : JSON.stringify(body));
  }
}
