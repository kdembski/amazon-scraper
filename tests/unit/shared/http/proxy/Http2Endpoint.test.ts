import http2 from "node:http2";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FingerprintGenerator } from "@/shared/http/FingerprintGenerator";
import type { Fingerprint } from "@/shared/http/http.types";
import { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
import {
  type H2Handler,
  readBody,
  respond,
  startH2Server,
} from "@@tests/support/h2Server";

const host = "www.amazon.de";

const makeFingerprint = (ciphers: string): Fingerprint => ({
  chromeVersion: 140,
  headers: [
    ["user-agent", "chrome"],
    ["accept", "text/html"],
  ],
  tls: { ciphers, sigalgs: "", ecdhCurve: "" },
  settings: { enablePush: false },
});

describe("Http2Endpoint", () => {
  let closeServer: (() => Promise<void>) | undefined;
  let endpoint: Http2Endpoint | undefined;

  afterEach(async () => {
    endpoint?.destroy();
    endpoint = undefined;
    await closeServer?.();
    closeServer = undefined;
  });

  const start = async (handler: H2Handler) => {
    const server = await startH2Server(handler);
    closeServer = server.close;

    return vi.fn((name: string, _fingerprint: Fingerprint, _signal: AbortSignal) =>
      server.connect(name)
    );
  };

  const generator = (...fingerprints: Fingerprint[]) => {
    const next = vi.fn(() => fingerprints.shift() ?? makeFingerprint("default"));
    return { next } as unknown as FingerprintGenerator;
  };

  const create = (
    connect: Awaited<ReturnType<typeof start>>,
    maxStreams = 100,
    options: {
      fingerprints?: FingerprintGenerator;
      idleTimeout?: number;
      maxAge?: number;
      statusWindow?: number;
    } = {}
  ) =>
    (endpoint = new Http2Endpoint(
      "direct4",
      connect,
      maxStreams,
      options.statusWindow,
      options.fingerprints ?? generator(),
      options.idleTimeout,
      options.maxAge
    ));

  const get = (path = "/", signal = new AbortController().signal) =>
    endpoint!.request(host, path, [["referer", "https://www.amazon.de/"]], signal);

  it("opens sessions with the status window as the stream window", async () => {
    let initialWindowSize: number | undefined;
    const connect = await start((stream) => {
      initialWindowSize = stream.session!.remoteSettings.initialWindowSize;
      respond(stream);
    });
    create(connect, 1, {
      fingerprints: generator({ ...makeFingerprint("a"), settings: { initialWindowSize: 6291456 } }),
      statusWindow: 64,
    });

    expect(await readBody((await get()).body)).toBe("ok");
    expect(initialWindowSize).toBe(64);
  });

  it("reuses one session and sends headers in order", async () => {
    const seen: string[][] = [];
    const connect = await start((stream, _headers, rawHeaders) => {
      seen.push(rawHeaders.filter((_, index) => index % 2 === 0));
      respond(stream);
    });
    create(connect);

    const first = await get("/a");
    expect(first.status).toBe(200);
    expect(await readBody(first.body)).toBe("ok");
    expect(await readBody((await get("/b")).body)).toBe("ok");

    expect(endpoint!.countSessions()).toBe(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(seen[1]).toEqual([
      ":method",
      ":authority",
      ":scheme",
      ":path",
      "user-agent",
      "accept",
      "referer",
      "accept-encoding",
      "priority",
    ]);
  });

  it("opens a second session when maxStreams is reached", async () => {
    const connect = await start((stream) => respond(stream));
    create(connect, 1);

    const responses = await Promise.all([get(), get()]);
    await Promise.all(responses.map((response) => readBody(response.body)));

    expect(connect).toHaveBeenCalledTimes(2);
    expect(endpoint!.countSessions()).toBe(2);
  });

  it("shares a connecting session among a burst of requests", async () => {
    const connect = await start((stream) => respond(stream));
    create(connect);

    const responses = await Promise.all(Array.from({ length: 20 }, () => get()));
    await Promise.all(responses.map((response) => readBody(response.body)));

    expect(connect).toHaveBeenCalledTimes(1);
    expect(endpoint!.countSessions()).toBe(1);
  });

  it("decompresses gzip and br bodies", async () => {
    const connect = await start((stream, headers) => {
      const br = headers[":path"] === "/br";
      stream.respond({ ":status": 200, "content-encoding": br ? "br" : "gzip" });
      stream.end(br ? zlib.brotliCompressSync("brotli") : zlib.gzipSync("gzipped"));
    });
    create(connect);

    expect(await readBody((await get("/gzip")).body)).toBe("gzipped");
    expect(await readBody((await get("/br")).body)).toBe("brotli");
  });

  it("closes a session after the idle timeout", async () => {
    const connect = await start((stream) => respond(stream));
    create(connect, 100, { idleTimeout: 50 });

    await readBody((await get()).body);

    await vi.waitFor(() => expect(endpoint!.countSessions()).toBe(0));
  });

  it("opens a new session with a new fingerprint after maxAge", async () => {
    const connect = await start((stream) => respond(stream));
    const fingerprints = generator(makeFingerprint("first"), makeFingerprint("second"));
    create(connect, 100, { fingerprints, maxAge: 50 });

    await readBody((await get()).body);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await readBody((await get()).body);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[0][1].tls.ciphers).toBe("first");
    expect(connect.mock.calls[1][1].tls.ciphers).toBe("second");
    await vi.waitFor(() => expect(endpoint!.countSessions()).toBe(1));
  });

  it("rejects open streams on GOAWAY and opens a new session", async () => {
    let count = 0;
    const connect = await start((stream) => {
      count++;
      if (count === 3) stream.session!.goaway(http2.constants.NGHTTP2_INTERNAL_ERROR);
      if (count > 3) respond(stream);
    });
    create(connect);

    const results = await Promise.allSettled([get(), get(), get()]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(await readBody((await get()).body)).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(endpoint!.countSessions()).toBe(1);
  });

  it("finishes open streams on a graceful GOAWAY but opens a new session", async () => {
    let count = 0;
    const connect = await start((stream) => {
      count++;
      if (count === 1) stream.session!.goaway(http2.constants.NGHTTP2_NO_ERROR);
      respond(stream);
    });
    create(connect);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await readBody((await get()).body)).toBe("ok");
    expect(await readBody((await get()).body)).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns on a GOAWAY with an error code", async () => {
    const connect = await start((stream) => {
      stream.session!.goaway(http2.constants.NGHTTP2_INTERNAL_ERROR);
    });
    create(connect);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await get().catch(() => {});

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        `HTTP/2 GOAWAY ${host} code ${http2.constants.NGHTTP2_INTERNAL_ERROR}`
      )
    );
    warn.mockRestore();
  });

  it("keeps the session when a body is destroyed", async () => {
    const connect = await start((stream, headers) => {
      if (headers[":path"] === "/ok") return respond(stream);

      stream.respond({ ":status": 200 });
      stream.write(Buffer.alloc(64 * 1024));
    });
    create(connect);
    const free = vi.fn();
    endpoint!.on("free", free);

    const response = await get("/stream");
    response.body.destroy();
    await vi.waitFor(() => expect(free).toHaveBeenCalled());

    expect(await readBody((await get("/ok")).body)).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(endpoint!.countSessions()).toBe(1);
  });

  it("emits free with the host when the last stream ends", async () => {
    const connect = await start((stream) => respond(stream));
    create(connect);
    const free = vi.fn();
    endpoint!.on("free", free);

    await readBody((await get()).body);

    await vi.waitFor(() => expect(free).toHaveBeenCalledWith(host));
  });

  it("rejects an aborted request with ETIMEDOUT and frees the stream", async () => {
    const connect = await start(() => {});
    create(connect);
    const free = vi.fn();
    endpoint!.on("free", free);
    const controller = new AbortController();

    const result = get("/", controller.signal);
    setTimeout(() => controller.abort(), 50);

    await expect(result).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.waitFor(() => expect(free).toHaveBeenCalledWith(host));
    expect(endpoint!.countSessions()).toBe(1);
  });

  it("drops a session that failed to connect and opens a new one for the next request", async () => {
    const connect = await start((stream) => respond(stream));
    const real = connect.getMockImplementation()!;
    connect.mockRejectedValueOnce(new Error("refused"));
    create(connect);

    await expect(get()).rejects.toThrow("refused");
    expect(endpoint!.countSessions()).toBe(0);

    connect.mockImplementation(real);
    expect(await readBody((await get()).body)).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("destroys a socket that connects after the endpoint was destroyed", async () => {
    const connect = await start((stream) => respond(stream));
    const real = connect.getMockImplementation()!;
    let finish!: () => void;
    let socket: Awaited<ReturnType<typeof real>> | undefined;
    connect.mockImplementationOnce(
      (name, fingerprint, signal) =>
        new Promise((resolve) => {
          finish = async () => resolve((socket = await real(name, fingerprint, signal)));
        })
    );
    create(connect);

    const result = get();
    endpoint!.destroy();
    finish();

    await expect(result).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(socket!.destroyed).toBe(true);
  });

  it("keeps a session with an open stream after the idle timeout", async () => {
    const connect = await start((stream) => setTimeout(() => respond(stream), 150));
    create(connect, 100, { idleTimeout: 50 });

    expect(await readBody((await get()).body)).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("closes a session past maxAge when its last stream ends instead of freeing it", async () => {
    const connect = await start((stream) => setTimeout(() => respond(stream), 80));
    create(connect, 100, { maxAge: 50 });
    const free = vi.fn();
    endpoint!.on("free", free);

    await readBody((await get()).body);

    await vi.waitFor(() => expect(endpoint!.countSessions()).toBe(0));
    expect(free).not.toHaveBeenCalled();
  });

  describe("hasIdle", () => {
    it("is false without a session", async () => {
      create(await start((stream) => respond(stream)));

      expect(endpoint!.hasIdle(host)).toBe(false);
    });

    it("is true for a connected session without streams", async () => {
      create(await start((stream) => respond(stream)));
      const free = vi.fn();
      endpoint!.on("free", free);

      await readBody((await get()).body);
      await vi.waitFor(() => expect(free).toHaveBeenCalled());

      expect(endpoint!.hasIdle(host)).toBe(true);
      expect(endpoint!.hasIdle("www.amazon.pl")).toBe(false);
    });

    it("is false while a stream is open", async () => {
      create(await start(() => {}));

      const result = get().catch(() => {});
      await vi.waitFor(() => expect(endpoint!.countSessions()).toBe(1));

      expect(endpoint!.hasIdle(host)).toBe(false);
      endpoint!.destroy();
      await result;
    });

    it("is false for a session past maxAge", async () => {
      create(await start((stream) => respond(stream)), 100, { maxAge: 50 });

      await readBody((await get()).body);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(endpoint!.hasIdle(host)).toBe(false);
    });
  });

  describe("closeIdle", () => {
    it("closes sessions without streams", async () => {
      create(await start((stream) => respond(stream)));
      const free = vi.fn();
      endpoint!.on("free", free);

      await readBody((await get()).body);
      await vi.waitFor(() => expect(free).toHaveBeenCalled());
      endpoint!.closeIdle(host);

      expect(endpoint!.countSessions()).toBe(0);
    });

    it("keeps a session with an open stream", async () => {
      let answer!: () => void;
      create(await start((stream) => (answer = () => respond(stream))));

      const result = get();
      await vi.waitFor(() => expect(answer).toBeDefined());
      endpoint!.closeIdle(host);
      answer();

      expect(await readBody((await result).body)).toBe("ok");
      expect(endpoint!.countSessions()).toBe(1);
    });
  });
});
