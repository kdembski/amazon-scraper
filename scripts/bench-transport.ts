import { fork } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const REQUESTS = 20000;
const CONCURRENCY = 200;
const MARKER = "BENCH-MARKER";

async function serve() {
  const { FakeAmazon } = await import("@@tests/support/fake/amazon");
  const page = gzipSync(Buffer.from(`<html>${randomBytes(21000).toString("base64")}</html>`));
  const half = randomBytes(24000).toString("base64");
  const stopBody = `<html>${half}${MARKER}${half}</html>`;
  const amazon = await new FakeAmazon().start();

  amazon.respond(({ url }) => {
    if (Math.random() < 0.1) return { status: 503 };
    if (url.includes("/stop")) return { body: stopBody };
    return { body: page, headers: { "content-encoding": "gzip" } };
  });
  process.send!(amazon.proxyLine);
}

async function bench() {
  const mode = process.env.HTTP2 ? "h2" : "h1";
  const child = fork(import.meta.filename, ["serve"], { execArgv: ["--import", "tsx"] });
  const proxyLine = await new Promise<string>((resolve) => child.once("message", resolve));
  const list = http.createServer((_req, res) => res.end(proxyLine));
  await new Promise<void>((resolve) => list.listen(0, "127.0.0.1", resolve));

  process.env.PROXY_LIST_URL = `http://127.0.0.1:${(list.address() as AddressInfo).port}`;
  process.env.NO_DIRECT = "1";
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const { ProxyService } = await import("@/shared/http/proxy/ProxyService");
  const { ScrapingClient } = await import("@/shared/http/ScrapingClient");
  const { MetricsService } = await import("@/shared/metrics/MetricsService");
  const { TokenBucketQueue } = await import("@/shared/http/TokenBucketQueue");

  const queue = TokenBucketQueue.getInstance();
  queue.concurrency = CONCURRENCY;
  queue.rps = 0;
  const proxies = ProxyService.getInstance();
  await proxies.loadProxies();
  const client = ScrapingClient.getInstance();
  const metrics = MetricsService.getInstance();
  metrics.drain();
  let ok = 0;
  let failed = 0;

  let peak = 0;
  const sampler = setInterval(() => (peak = Math.max(peak, proxies.countConnections())), 20);

  const before = process.cpuUsage();
  await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      client
        .get(`https://www.amazon.de/${i % 2 ? "stop" : "page"}?i=${i}`, {
          ...(i % 2 && { stopAt: [MARKER] }),
        })
        .then(
          () => ok++,
          () => failed++
        )
    )
  );
  const { user, system } = process.cpuUsage(before);
  clearInterval(sampler);

  const newConnections = metrics
    .drain()
    .filter((row) => row.metric === "connections")
    .reduce((sum, row) => sum + row.value, 0);

  const perRequest = ((user + system) / REQUESTS).toFixed(1);
  console.log(
    `mode=${mode} requests=${REQUESTS} cpu_us_per_request=${perRequest} connections=${peak} ` +
      `new_connections=${newConnections} ok=${ok} failed=${failed}`
  );
  child.kill();

  const share = ok / REQUESTS;
  process.exit(share >= 0.85 && share <= 0.95 ? 0 : 1);
}

await (process.argv[2] === "serve" ? serve() : bench());
