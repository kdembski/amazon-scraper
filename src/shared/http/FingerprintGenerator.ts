import _ from "lodash";
import type { Fingerprint } from "@/shared/http/http.types";

const chromeVersions = [138, 139, 140, 141];

const cipherPrefix = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
];

const gcmCiphers = [
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
];

const cbcCiphers = [
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-SHA",
  "AES256-SHA",
];

const sigalgs = [
  "ecdsa_secp256r1_sha256",
  "rsa_pss_rsae_sha256",
  "rsa_pkcs1_sha256",
  "ecdsa_secp384r1_sha384",
  "rsa_pss_rsae_sha384",
  "rsa_pkcs1_sha384",
  "rsa_pss_rsae_sha512",
  "rsa_pkcs1_sha512",
];

const ecdhCurves = ["X25519:P-256:P-384", "X25519:P-256"];

const accept =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";

export class FingerprintGenerator {
  constructor(private random = Math.random) {}

  next(): Fingerprint {
    const chromeVersion = this.pick(chromeVersions);

    return {
      chromeVersion,
      headers: [
        [
          "sec-ch-ua",
          `"Chromium";v="${chromeVersion}", "Not?A_Brand";v="8", "Google Chrome";v="${chromeVersion}"`,
        ],
        ["sec-ch-ua-mobile", "?0"],
        ["sec-ch-ua-platform", '"Windows"'],
        ["upgrade-insecure-requests", "1"],
        [
          "user-agent",
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`,
        ],
        ["accept", accept],
        ["sec-fetch-site", "same-origin"],
        ["sec-fetch-mode", "navigate"],
        ["sec-fetch-user", "?1"],
        ["sec-fetch-dest", "document"],
      ],
      tls: {
        ciphers: this.ciphers(),
        sigalgs: sigalgs.slice(0, sigalgs.length - this.int(3)).join(":"),
        ecdhCurve: this.pick(ecdhCurves),
      },
      settings: {
        headerTableSize: 65536,
        enablePush: false,
        initialWindowSize: 6291456,
        maxHeaderListSize: 262144,
      },
    };
  }

  private ciphers() {
    const cbc = this.shuffle(cbcCiphers).slice(this.int(4));
    const tail = this.shuffle([...gcmCiphers, ...cbc]);

    return [...cipherPrefix, ...tail].join(":");
  }

  private int(max: number) {
    return Math.floor(this.random() * max);
  }

  private pick<T>(items: T[]) {
    return items[this.int(items.length)];
  }

  private shuffle<T>(items: T[]) {
    const result = _.clone(items);

    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }
}
