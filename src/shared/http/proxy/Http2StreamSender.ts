import http2 from "node:http2";
import { type Readable, Transform } from "node:stream";
import zlib from "node:zlib";
import { codedError, timedOut } from "@/shared/http/abort";
import type { Fingerprint, ShopResponse } from "@/shared/http/http.types";

type StreamRequest = {
  host: string;
  path: string;
  headers: [string, string][];
  fingerprint: Fingerprint;
  statusWindow?: number;
  signal: AbortSignal;
};

const decoders: Record<string, () => Transform> = {
  gzip: () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
  zstd: () => zlib.createZstdDecompress(),
};

export class Http2StreamSender {
  send(client: http2.ClientHttp2Session, request: StreamRequest, onClose: () => void) {
    return new Promise<ShopResponse>((resolve, reject) => {
      let stream: http2.ClientHttp2Stream;

      try {
        stream = client.request(this.buildHeaders(request), { endStream: true });
      } catch (error) {
        onClose();
        reject(error);
        return;
      }

      let body: Readable | undefined;
      let widened = false;
      const onAbort = () => {
        reject(timedOut());
        stream.close(http2.constants.NGHTTP2_CANCEL);
        body?.destroy(timedOut());
      };

      request.signal.addEventListener("abort", onAbort, { once: true });
      stream.on("error", reject);
      stream.once("response", (headers) => {
        if (request.statusWindow && Number(headers[":status"]) < 400) {
          widened = true;
          this.setWindow(client, request.fingerprint.settings.initialWindowSize);
        }

        body = this.decode(stream, headers);
        resolve({ status: Number(headers[":status"]), headers, body });
      });
      stream.once("close", () => {
        request.signal.removeEventListener("abort", onAbort);
        if (widened) this.setWindow(client, request.statusWindow);
        reject(codedError(`Stream closed with code ${stream.rstCode}`, "ERR_HTTP2_STREAM_CLOSED"));
        onClose();
      });
    });
  }

  private setWindow(client: http2.ClientHttp2Session, initialWindowSize?: number) {
    if (!initialWindowSize || client.closed || client.destroyed) return;

    try {
      client.settings({ initialWindowSize });
    } catch {}
  }

  private buildHeaders({ host, path, headers, fingerprint }: StreamRequest) {
    return Object.fromEntries([
      [":method", "GET"],
      [":authority", host],
      [":scheme", "https"],
      [":path", path],
      ...fingerprint.headers,
      ...headers,
      ["accept-encoding", "gzip, deflate, br, zstd"],
      ["priority", "u=0, i"],
    ]);
  }

  private guard(headers: http2.IncomingHttpHeaders) {
    const expected = Number(headers["content-length"]);
    if (!headers["content-length"] || !Number.isFinite(expected)) return undefined;

    return () => {
      let received = 0;

      return new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          callback(null, chunk);
        },
        flush(callback) {
          if (received >= expected) return callback();

          callback(codedError("Body cut off", "ECONNRESET"));
        },
      });
    };
  }

  private decode(stream: http2.ClientHttp2Stream, headers: http2.IncomingHttpHeaders) {
    const create = decoders[String(headers["content-encoding"])] ?? this.guard(headers);
    if (!create) return stream;

    const decoder = create();

    decoder.on("error", () => {});
    stream.on("error", (error) => decoder.destroy(error));
    decoder.on("close", () => {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      stream.destroy();
    });

    return stream.pipe(decoder);
  }
}
