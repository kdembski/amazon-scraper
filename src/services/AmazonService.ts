import axios from "axios";
import UserAgent from "user-agents";
import { HttpsProxyAgent } from "https-proxy-agent";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ArgsService } from "@/services/ArgsService";
import { CronJob } from "cron";

export class AmazonService {
  private static instance: AmazonService;
  private proxies: string[] = [];
  private argsService;
  queueService;

  private constructor(
    argsService = ArgsService.getInstance(),
    queueService = new RequestQueueService(
      argsService.getLimitFlag(),
      "\x1b[36m%s\x1b[0m"
    )
  ) {
    this.argsService = argsService;
    this.queueService = queueService;
    queueService.start();

    this.loadProxies();

    const updateJob = new CronJob("0 0 */1 * * *", async () => {
      await this.loadProxies();
    });
    updateJob.start();
  }

  public static getInstance(): AmazonService {
    if (!AmazonService.instance) {
      AmazonService.instance = new AmazonService();
    }

    return AmazonService.instance;
  }

  get<T>(
    url: string,
    referer?: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    this.queueService.request(() => {
      const proxy = this.getRandomProxy();

      const userAgent = new UserAgent().toString();
      const httpsAgent = new HttpsProxyAgent("http://" + proxy, {
        keepAlive: true,
      });

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(url, {
            httpsAgent,
            headers: {
              "User-Agent": userAgent,
              Referer: referer,
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
            maxRedirects: 0,
            ...(this.argsService.getTurboFlag() && {
              adapter: "fetch",
              fetchOptions: { priority: "low" },
            }),
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
            //console.log(`Amazon: ${response.status}`);
          })
          .catch((e) => {
            callback?.onError?.(e);
            //console.log(`Amazon: ${e.message}`);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  private loadProxies() {
    return new Promise((resolve) => {
      const url = `https://api.proxyscrape.com/v2/account/datacenter_shared/proxy-list?auth=${process.env.PROXY_API_KEY}&type=getproxies&protocol=http`;
      axios
        .get<string>(url)
        .then((response) => {
          const data = response.data;
          let array = data.includes("\r\n")
            ? data.split("\r\n")
            : data.split("\n");

          array = array.filter((v) => !!v);
          this.proxies = array;

          resolve(data);
        })
        .catch((e) => {
          console.log(e);
        });
    });
  }

  private getRandomProxy() {
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
  }
}
