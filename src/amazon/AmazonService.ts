import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

export class AmazonService {
  private static instance: AmazonService;
  private static pending = 0;
  private static pendingLimit = 30;
  private static queue: Function[] = [];
  private proxies = [
    "http://156.228.87.49:3128",
    "http://156.228.125.217:3128",
    "http://156.228.88.56:3128",
    "http://104.167.24.124:3128",
    "http://156.228.99.158:3128",
    "http://154.213.197.77:3128",
    "http://156.253.177.68:3128",
    "http://104.207.42.150:3128",
    "http://104.207.58.255:3128",
    "http://156.228.171.173:3128",
    "http://154.94.12.171:3128",
    "http://156.228.79.196:3128",
    "http://156.228.124.141:3128",
    "http://156.228.174.155:3128",
    "http://156.228.76.13:3128",
    "http://156.253.176.19:3128",
    "http://154.213.198.215:3128",
    "http://156.228.109.3:3128",
    "http://45.201.10.154:3128",
    "http://154.213.203.144:3128",
    "http://154.94.15.137:3128",
    "http://156.228.111.147:3128",
    "http://104.207.47.182:3128",
    "http://154.94.14.119:3128",
    "http://104.167.25.168:3128",
    "http://156.233.90.61:3128",
    "http://104.167.28.142:3128",
    "http://156.228.82.87:3128",
    "http://156.228.83.3:3128",
    "http://156.233.89.93:3128",
    "http://156.228.96.25:3128",
    "http://156.228.112.136:3128",
    "http://45.202.78.251:3128",
    "http://156.228.80.253:3128",
    "http://156.228.109.172:3128",
    "http://156.233.95.232:3128",
    "http://156.253.175.197:3128",
    "http://104.207.54.92:3128",
    "http://156.228.102.44:3128",
    "http://156.228.106.215:3128",
    "http://154.213.198.153:3128",
    "http://104.207.38.168:3128",
    "http://104.167.26.242:3128",
    "http://156.228.84.63:3128",
    "http://156.228.85.143:3128",
    "http://156.228.176.160:3128",
    "http://156.228.102.12:3128",
    "http://154.94.14.204:3128",
    "http://156.253.164.174:3128",
    "http://156.228.95.60:3128",
    "http://156.249.137.103:3128",
    "http://156.228.108.178:3128",
    "http://156.253.177.250:3128",
    "http://156.228.111.150:3128",
    "http://104.167.28.143:3128",
    "http://154.214.1.58:3128",
    "http://154.91.171.72:3128",
    "http://104.207.56.164:3128",
    "http://104.207.56.34:3128",
    "http://156.228.125.255:3128",
    "http://154.213.195.103:3128",
    "http://156.228.78.163:3128",
    "http://154.213.193.1:3128",
    "http://156.228.104.86:3128",
    "http://156.228.93.128:3128",
    "http://156.228.96.142:3128",
    "http://154.214.1.88:3128",
    "http://156.228.100.126:3128",
    "http://156.249.138.105:3128",
    "http://156.233.72.245:3128",
    "http://45.201.10.183:3128",
    "http://156.228.106.160:3128",
    "http://156.233.74.23:3128",
    "http://156.228.83.80:3128",
    "http://104.207.44.214:3128",
    "http://156.233.85.177:3128",
    "http://156.228.174.82:3128",
    "http://104.207.57.247:3128",
    "http://45.202.79.2:3128",
    "http://156.228.176.114:3128",
    "http://156.228.177.35:3128",
    "http://104.207.57.95:3128",
    "http://156.233.90.126:3128",
    "http://156.228.181.164:3128",
    "http://156.249.138.134:3128",
    "http://154.213.195.250:3128",
    "http://156.228.83.73:3128",
    "http://156.233.72.101:3128",
    "http://154.213.199.44:3128",
    "http://156.228.85.212:3128",
    "http://156.233.93.252:3128",
    "http://104.207.37.72:3128",
    "http://156.228.183.230:3128",
    "http://156.228.113.240:3128",
    "http://156.228.104.35:3128",
    "http://156.233.89.216:3128",
    "http://104.167.28.48:3128",
    "http://104.207.48.254:3128",
    "http://104.207.41.101:3128",
    "http://104.207.45.57:3128",
  ];
  private userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 11; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Mobile Safari/537.36",
    "Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:68.0) Gecko/20100101 Firefox/68.0",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:78.0) Gecko/20100101 Firefox/78.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/92.0.902.67",
  ];

  private constructor() {}

  public static getInstance(): AmazonService {
    if (!AmazonService.instance) {
      AmazonService.instance = new AmazonService();
    }

    return AmazonService.instance;
  }

  get<T>(
    url: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    referer?: string
  ) {
    if (AmazonService.pending >= AmazonService.pendingLimit) {
      AmazonService.queue.push(() => this.get(url, callback));
      return;
    }

    const httpsAgent = new HttpsProxyAgent(
      this.proxies[Math.floor(Math.random() * this.proxies.length)]
    );

    const userAgent =
      this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

    AmazonService.pending++;
    return new Promise<T>(async (resolve) => {
      return axios
        .get<T>(url, {
          httpsAgent,
          headers: {
            "User-Agent": userAgent,
            Referer: referer,
            "Referrer-Policy": "strict-origin-when-cross-origin",
          },
        })
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
          console.log(response.status);
        })
        .catch((e) => {
          callback?.onError?.(e);
          console.error(e.message);
        })
        .finally(() => {
          callback?.onFinally?.();
          AmazonService.pending--;

          const next = AmazonService.queue.shift();
          next?.();
        });
    });
  }
}
