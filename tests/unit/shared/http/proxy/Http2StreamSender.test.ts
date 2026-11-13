import { once } from "node:events";
import http2 from "node:http2";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fingerprint } from "@/shared/http/http.types";
import { Http2StreamSender } from "@/shared/http/proxy/Http2StreamSender";
import {
  type H2Handler,
  readBody,
  respond,
  startH2Server,
} from "@@tests/support/h2Server";

const host = "www.amazon.de";

const fingerprint: Fingerprint = {
  chromeVersion: 140,
  headers: [["user-agent", "chrome"]],
  tls: { ciphers: "", sigalgs: "", ecdhCurve: "" },
  settings: {},
};

describe("Http2StreamSender", () => {
  let closers: (() => unknown)[] = [];

  afterEach(async () => {
    for (const close of closers) await close();
    closers = [];
  });

  const open = async (handler: H2Handler) => {
    const server = await startH2Server(handler);
    closers.push(server.close);
    const socket = await server.connect(host);
    const client = http2.connect(`https://${host}`, { createConnection: () => socket });
    closers.unshift(() => client.destroy());
    return client;
  };

  const send = (
    client: http2.ClientHttp2Session,
    onClose = vi.fn(),
    signal = new AbortController().signal
  ) =>
    new Http2StreamSender().send(
      client,
      { host, path: "/dp/1", headers: [["referer", "https://r/"]], fingerprint, signal },
      onClose
    );

  it("sends the headers in order and returns the status", async () => {
    let raw: string[] = [];
    const client = await open((stream, _headers, rawHeaders) => {
      raw = rawHeaders;
      stream.respond({ ":status": 404 });
      stream.end();
    });

    const response = await send(client);

    expect(response.status).toBe(404);
    expect(raw).toEqual([
      ":method", "GET",
      ":authority", host,
      ":scheme", "https",
      ":path", "/dp/1",
      "user-agent", "chrome",
      "referer", "https://r/",
      "accept-encoding", "gzip, deflate, br, zstd",
      "priority", "u=0, i",
    ]);
  });

  it.each([
    ["deflate", zlib.deflateSync],
    ["zstd", zlib.zstdCompressSync],
  ])("decompresses %s", async (encoding, compress) => {
    const client = await open((stream) => {
      stream.respond({ ":status": 200, "content-encoding": encoding });
      stream.end(compress(Buffer.from("plain")));
    });

    expect(await readBody((await send(client)).body)).toBe("plain");
  });

  it("calls onClose once when the stream ends", async () => {
    const client = await open((stream) => respond(stream));
    const onClose = vi.fn();

    await readBody((await send(client, onClose)).body);

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("cancels the stream on abort and rejects with ETIMEDOUT", async () => {
    let rstCode: number | undefined;
    const client = await open((stream) => stream.on("close", () => (rstCode = stream.rstCode)));
    const controller = new AbortController();
    const onClose = vi.fn();

    const result = send(client, onClose, controller.signal);
    setTimeout(() => controller.abort(), 20);

    await expect(result).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.waitFor(() => expect(rstCode).toBe(http2.constants.NGHTTP2_CANCEL));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the stream when a decoded body is destroyed", async () => {
    let rstCode: number | undefined;
    const client = await open((stream) => {
      stream.on("close", () => (rstCode = stream.rstCode));
      stream.respond({ ":status": 200, "content-encoding": "gzip" });
      stream.write(zlib.gzipSync(Buffer.alloc(1024)).subarray(0, 20));
    });

    const response = await send(client);
    response.body.destroy();

    await vi.waitFor(() => expect(rstCode).toBe(http2.constants.NGHTTP2_CANCEL));
  });

  it("rejects reading a corrupt gzip body and cancels the stream", async () => {
    let rstCode: number | undefined;
    const client = await open((stream) => {
      stream.on("close", () => (rstCode = stream.rstCode));
      stream.respond({ ":status": 200, "content-encoding": "gzip" });
      stream.write(Buffer.from("definitely not gzip"));
    });

    const response = await send(client);

    await expect(readBody(response.body)).rejects.toThrow();
    await vi.waitFor(() => expect(rstCode).toBe(http2.constants.NGHTTP2_CANCEL));
  });

  it("survives an abort after the response when a gzip body is never read", async () => {
    const client = await open((stream) => {
      stream.respond({ ":status": 200, "content-encoding": "gzip" });
      stream.write(zlib.gzipSync(Buffer.alloc(1024)).subarray(0, 20));
    });
    const controller = new AbortController();
    const onClose = vi.fn();

    await send(client, onClose, controller.signal);
    controller.abort();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("calls onClose and rejects when the session is closed", async () => {
    const client = await open((stream) => respond(stream));
    client.close();
    await once(client, "close");
    const onClose = vi.fn();

    await expect(send(client, onClose)).rejects.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
