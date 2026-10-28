import { connect } from "node:net";

export const tcpPing = (host: string, port: number, timeoutMs: number) => {
  return new Promise<number | undefined>((resolve) => {
    const start = performance.now();
    const socket = connect({ host, port, timeout: timeoutMs });
    const finish = (ms?: number) => {
      socket.destroy();
      resolve(ms);
    };
    socket.once("connect", () => finish(Math.round((performance.now() - start) * 10) / 10));
    socket.once("timeout", () => finish());
    socket.once("error", () => finish());
  });
};
