import { describe, expect, it } from "vitest";
import { FingerprintGenerator } from "@/shared/http/FingerprintGenerator";

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const prefix =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256";

const nonCbc = [
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
];

describe("FingerprintGenerator", () => {
  it("keeps the cipher prefix and every non-CBC suite", () => {
    const generator = new FingerprintGenerator(seeded(1));

    for (let i = 0; i < 30; i++) {
      const { ciphers } = generator.next().tls;
      const list = ciphers.split(":");

      expect(ciphers.startsWith(`${prefix}:`)).toBe(true);
      nonCbc.forEach((suite) => expect(list).toContain(suite));
    }
  });

  it("uses chromeVersion in user-agent and sec-ch-ua", () => {
    const generator = new FingerprintGenerator(seeded(2));

    for (let i = 0; i < 30; i++) {
      const { chromeVersion, headers } = generator.next();
      const map = new Map(headers);

      expect([138, 139, 140, 141]).toContain(chromeVersion);
      expect(map.get("user-agent")).toContain(`Chrome/${chromeVersion}.0.0.0`);
      expect(map.get("sec-ch-ua")).toBe(
        `"Chromium";v="${chromeVersion}", "Not?A_Brand";v="8", "Google Chrome";v="${chromeVersion}"`,
      );
    }
  });

  it("orders headers like Chrome", () => {
    const { headers } = new FingerprintGenerator(seeded(3)).next();

    expect(headers.map(([name]) => name)).toEqual([
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "upgrade-insecure-requests",
      "user-agent",
      "accept",
      "sec-fetch-site",
      "sec-fetch-mode",
      "sec-fetch-user",
      "sec-fetch-dest",
    ]);
  });

  it("returns fixed settings and bounded sigalgs and curves", () => {
    const { settings, tls } = new FingerprintGenerator(seeded(4)).next();

    expect(settings).toEqual({
      headerTableSize: 65536,
      enablePush: false,
      initialWindowSize: 6291456,
      maxHeaderListSize: 262144,
    });
    expect(tls.sigalgs.split(":").length).toBeGreaterThanOrEqual(6);
    expect(tls.sigalgs.startsWith("ecdsa_secp256r1_sha256:")).toBe(true);
    expect(["X25519:P-256:P-384", "X25519:P-256"]).toContain(tls.ecdhCurve);
  });

  it("uses the given stream window size", () => {
    const { settings } = new FingerprintGenerator(seeded(4), 262144).next();

    expect(settings.initialWindowSize).toBe(262144);
  });

  it("varies ciphers with Math.random", () => {
    const generator = new FingerprintGenerator();
    const seen = new Set<string>();

    for (let i = 0; i < 50; i++) seen.add(generator.next().tls.ciphers);

    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});
