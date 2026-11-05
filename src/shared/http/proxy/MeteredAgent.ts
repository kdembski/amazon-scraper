import https from "node:https";
import type net from "node:net";

export class MeteredAgent extends https.Agent {
  constructor(
    options: https.AgentOptions,
    private onConnect: (socket: net.Socket, host: string) => void
  ) {
    super(options);
  }

  createConnection(...args: Parameters<https.Agent["createConnection"]>) {
    const socket = super.createConnection(...args);
    this.onConnect(socket as net.Socket, args[0].host ?? "");
    return socket;
  }
}
