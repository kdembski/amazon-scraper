import { ChildProcess, execFileSync, spawn } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { FakeAmazon } from "@@tests/support/fake/amazon";
import { FakeBackend } from "@@tests/support/fake/backend";

// node runs dist/index.js, docker runs the production image
export const runtime = process.env.E2E_RUNTIME === "docker" ? "docker" : "node";
export const image = "amazon-scraper:e2e";

const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
let containers = 0;

export type Process = Awaited<ReturnType<typeof spawnScraper>>;

// Runs the built scraper as its own process against the fakes, configured
// only through env and flags like in docker-compose
export async function spawnScraper(
  args: string[],
  configure: (fakes: { backend: FakeBackend; amazon: FakeAmazon }) => void
) {
  const host = runtime === "docker" ? "host.docker.internal" : "127.0.0.1";
  const backend = await new FakeBackend(host).start();
  const amazon = await new FakeAmazon(host).start();
  backend.on("GET", "proxies", amazon.proxyLine);
  configure({ backend, amazon });

  const env = {
    API_URL: backend.url,
    PROXY_LIST_URL: `${backend.url}/proxies`,
    PROXY_LIST_TOKEN: "unused",
    name: "e2e",
  };

  const { child, cleanup } =
    runtime === "docker" ? runContainer(args, env) : runNode(args, env);

  let output = "";
  child.stdout!.on("data", (data) => (output += data));
  child.stderr!.on("data", (data) => (output += data));

  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      cleanup();
      await exited;
    }
    await Promise.all([backend.stop(), amazon.stop()]);
  };

  return {
    backend,
    amazon,
    child,
    stop,
    // stdout and stderr so far, for failure messages
    output: () => output,
  };
}

function runNode(args: string[], env: Record<string, string>) {
  // Outside the repo, so dotenv does not pick up a local .env
  const cwd = mkdtempSync(join(tmpdir(), "amazon-scraper-e2e-"));
  const child: ChildProcess = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const cleanup = () => {
    child.kill();
    child.once("exit", () => rmSync(cwd, { recursive: true, force: true }));
  };
  return { child, cleanup };
}

function runContainer(args: string[], env: Record<string, string>) {
  const name = `amazon-scraper-e2e-${process.pid}-${containers++}`;
  const envArgs = Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);

  const child: ChildProcess = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      // Same as extra_hosts in docker-compose.yml
      "--add-host",
      "host.docker.internal:host-gateway",
      ...envArgs,
      image,
      ...args,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  const cleanup = () => {
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  };
  return { child, cleanup };
}
