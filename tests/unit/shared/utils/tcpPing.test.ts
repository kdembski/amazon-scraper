import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { tcpPing } from "@/shared/utils/tcpPing";

const listen = async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};

describe("tcpPing", () => {
  it("returns the connect time in ms", async () => {
    const server = await listen();
    const { port } = server.address() as AddressInfo;

    const ms = await tcpPing("127.0.0.1", port, 1000);

    server.close();
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("returns undefined when the connection fails", async () => {
    const server = await listen();
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));

    expect(await tcpPing("127.0.0.1", port, 1000)).toBeUndefined();
  });

  it("returns undefined after the timeout", async () => {
    expect(await tcpPing("10.255.255.1", 443, 1)).toBeUndefined();
  });
});
