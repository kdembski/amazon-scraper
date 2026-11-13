import { EventEmitter } from "node:events";
import http2 from "node:http2";
import type tls from "node:tls";
import _ from "lodash";
import { FingerprintGenerator } from "@/shared/http/FingerprintGenerator";
import type { Fingerprint, Route, ShopResponse } from "@/shared/http/http.types";
import { Http2StreamSender } from "@/shared/http/proxy/Http2StreamSender";

type Session = {
  fingerprint: Fingerprint;
  aborter: AbortController;
  createdAt: number;
  // Reserved by requests, also while the session is connecting
  streams: number;
  ready: Promise<http2.ClientHttp2Session>;
  client?: http2.ClientHttp2Session;
};

const timedOut = () => Object.assign(new Error("Request aborted"), { code: "ETIMEDOUT" });

export class Http2Endpoint extends EventEmitter {
  private sessions = new Map<string, Session[]>();
  private sender = new Http2StreamSender();

  constructor(
    public route: Route,
    private connect: (
      host: string,
      fingerprint: Fingerprint,
      signal: AbortSignal
    ) => Promise<tls.TLSSocket>,
    private maxStreams: number,
    private fingerprints = new FingerprintGenerator(),
    private idleTimeout = 15 * 1000,
    private maxAge = 10 * 60 * 1000
  ) {
    super();
  }

  async request(
    host: string,
    path: string,
    headers: [string, string][],
    signal: AbortSignal
  ): Promise<ShopResponse> {
    if (signal.aborted) throw timedOut();

    const session = this.pick(host) ?? this.open(host);
    session.streams++;

    try {
      await this.wait(session.ready, signal);
    } catch (error) {
      this.release(host, session);
      throw error;
    }

    return this.sender.send(
      session.client!,
      { host, path, headers, fingerprint: session.fingerprint, signal },
      () => this.release(host, session)
    );
  }

  hasIdle(host: string) {
    return this.list(host).some(
      (session) => session.streams === 0 && this.isUsable(session) && this.isFresh(session)
    );
  }

  closeIdle(host: string) {
    this.list(host)
      .filter((session) => session.streams === 0 && session.client)
      .forEach((session) => this.retire(host, session));
  }

  destroy() {
    this.sessions.forEach((sessions) =>
      sessions.forEach((session) => {
        session.aborter.abort();
        session.client?.destroy();
      })
    );
    this.sessions.clear();
  }

  countSessions() {
    return _.sumBy([...this.sessions.values()], (sessions) => sessions.length);
  }

  private list(host: string) {
    return this.sessions.get(host) ?? [];
  }

  private pick(host: string) {
    this.list(host)
      .filter((session) => session.streams === 0 && session.client && !this.isFresh(session))
      .forEach((session) => this.retire(host, session));

    return this.list(host).find(
      (session) =>
        this.isFresh(session) &&
        !session.client?.closed &&
        !session.client?.destroyed &&
        session.streams < this.capacity(session)
    );
  }

  private capacity(session: Session) {
    const remote = session.client?.remoteSettings.maxConcurrentStreams;

    return Math.min(this.maxStreams, remote ?? this.maxStreams);
  }

  private isFresh(session: Session) {
    return Date.now() - session.createdAt < this.maxAge;
  }

  private isUsable(session: Session) {
    return !!session.client && !session.client.closed && !session.client.destroyed;
  }

  private open(host: string) {
    const fingerprint = this.fingerprints.next();
    const aborter = new AbortController();
    const session: Session = {
      fingerprint,
      aborter,
      createdAt: Date.now(),
      streams: 0,
      ready: this.establish(host, fingerprint, aborter.signal).then((client) =>
        this.attach(host, session, client)
      ),
    };

    session.ready.catch(() => this.remove(host, session));
    this.sessions.set(host, [...this.list(host), session]);

    return session;
  }

  private async establish(host: string, fingerprint: Fingerprint, aborted: AbortSignal) {
    const signal = AbortSignal.any([AbortSignal.timeout(20_000), aborted]);
    const socket = await this.connect(host, fingerprint, signal);

    if (aborted.aborted) {
      socket.destroy();
      throw timedOut();
    }

    return http2.connect(`https://${host}`, {
      createConnection: () => socket,
      settings: fingerprint.settings,
    });
  }

  private attach(host: string, session: Session, client: http2.ClientHttp2Session) {
    client.once("connect", () => client.setLocalWindowSize(15663105));
    client.on("error", () => this.remove(host, session));
    client.on("goaway", () => this.remove(host, session));
    client.on("close", () => this.remove(host, session));
    client.setTimeout(this.idleTimeout, () => {
      if (session.streams === 0) this.retire(host, session);
    });
    session.client = client;

    return client;
  }

  private wait<T>(promise: Promise<T>, signal: AbortSignal) {
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(timedOut());
      signal.addEventListener("abort", onAbort, { once: true });
    });

    return Promise.race([promise, aborted]).finally(() =>
      signal.removeEventListener("abort", onAbort)
    );
  }

  private release(host: string, session: Session) {
    session.streams--;
    if (session.streams > 0 || !this.isUsable(session)) return;
    if (!this.list(host).includes(session)) return;

    if (!this.isFresh(session)) {
      this.retire(host, session);
      return;
    }

    this.emit("free", host);
  }

  private retire(host: string, session: Session) {
    this.remove(host, session);
    session.client?.close();
  }

  private remove(host: string, session: Session) {
    const rest = this.list(host).filter((known) => known !== session);

    if (rest.length) {
      this.sessions.set(host, rest);
      return;
    }

    this.sessions.delete(host);
  }
}
