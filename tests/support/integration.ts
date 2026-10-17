import { vi } from "vitest";
import { AmazonScraper } from "@/scrapers/AmazonScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { ProxyService } from "@/services/ProxyService";
import { FakeAmazon } from "@@tests/support/fake/amazon";
import { FakeBackend } from "@@tests/support/fake/backend";
import { resetSingleton } from "@@tests/support/singleton";

const singletons = [ArgsService, ApiService, ProxyService, AmazonService];
const argv = process.argv;

const instanceOf = <T>(singleton: { getInstance(): T }) =>
  (singleton as unknown as { instance?: T }).instance;

export type World = Awaited<ReturnType<typeof startWorld>>;

// Fake backend and Amazon behind a fake proxy, wired in through env the same
// way production configures the scraper
export async function startWorld() {
  const backend = await new FakeBackend().start();
  const amazon = await new FakeAmazon().start();
  backend.on("GET", "proxies", amazon.proxyLine);

  vi.stubEnv("API_URL", backend.url);
  vi.stubEnv("PROXY_LIST_URL", `${backend.url}/proxies`);
  vi.stubEnv("name", "it");
  vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");

  return { backend, amazon };
}

// Builds the whole object graph from fresh singletons, as index.ts does
export function bootScraper(args: string[] = []) {
  process.argv = [argv[0], "index.ts", ...args];
  singletons.forEach(resetSingleton);

  const scraper = new AmazonScraper();
  return { scraper, queue: AmazonService.getInstance().queueService };
}

export async function stopWorld({ backend, amazon }: World) {
  // The queue loop reschedules itself through start(), so this ends it
  const queue = instanceOf(AmazonService)?.queueService;
  if (queue) queue.start = () => {};

  const proxyService = instanceOf(ProxyService) as unknown as
    | { agents: Map<string, { destroy(): void }> }
    | undefined;
  proxyService?.agents.forEach((agent) => agent.destroy());

  await Promise.all([backend.stop(), amazon.stop()]);
  singletons.forEach(resetSingleton);
  process.argv = argv;
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
