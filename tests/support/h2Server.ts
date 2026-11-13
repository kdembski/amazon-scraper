import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import tls from "node:tls";
import { generate } from "selfsigned";

export type H2Handler = (
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
  rawHeaders: string[]
) => void;

let certificate: Promise<{ key: string; cert: string }> | undefined;

const getCertificate = () =>
  (certificate ??= generate([{ name: "commonName", value: "www.amazon.de" }], {
    keySize: 2048,
  }).then((pems) => ({ key: pems.private, cert: pems.cert })));

// Local h2 server; connect() opens a TLS socket to it the way ShopConnector does
export const startH2Server = async (handler: H2Handler) => {
  const server = http2.createSecureServer(await getCertificate());
  const sessions: http2.ServerHttp2Session[] = [];

  server.on("session", (session) => sessions.push(session));
  server.on(
    "stream",
    (
      stream: http2.ServerHttp2Stream,
      headers: http2.IncomingHttpHeaders,
      _flags: number,
      rawHeaders: string[]
    ) => {
      stream.on("error", () => {});
      handler(stream, headers, rawHeaders);
    }
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  const connect = async (host: string) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      servername: host,
      ALPNProtocols: ["h2"],
      rejectUnauthorized: false,
    });
    await once(socket, "secureConnect");
    return socket;
  };

  const close = async () => {
    sessions.forEach((session) => session.destroy());
    await new Promise((resolve) => server.close(resolve));
  };

  return { connect, close };
};

export const respond = (stream: http2.ServerHttp2Stream, body = "ok") => {
  stream.respond({ ":status": 200 });
  stream.end(body);
};

export const readBody = async (body: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};
