import http from "node:http";
import https from "node:https";
import type net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeteredAgent } from "@/shared/http/proxy/MeteredAgent";

describe("MeteredAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes every new connection to onConnect and returns it", () => {
    const socket = { bytesRead: 1 };
    vi.spyOn(https.Agent.prototype, "createConnection").mockReturnValue(
      socket as unknown as net.Socket
    );
    const onConnect = vi.fn();
    const agent = new MeteredAgent({}, onConnect);

    expect(agent.createConnection({} as http.ClientRequestArgs)).toBe(socket);
    expect(onConnect).toHaveBeenCalledWith(socket);
  });
});
