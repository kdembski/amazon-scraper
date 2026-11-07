import http from "http";
import axios, { AxiosRequestConfig } from "axios";

const SEND_TIMEOUT = 30 * 1000;

export class ApiService {
  private static instance: ApiService;

  private constructor(
    private agent = new http.Agent({ keepAlive: true })
  ) {}

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }

    return ApiService.instance;
  }

  private url(path: string) {
    return process.env.API_URL + "/" + path;
  }

  private config(extra: AxiosRequestConfig = {}): AxiosRequestConfig {
    return {
      ...extra,
      headers: { ...extra.headers, Authorization: `Bearer ${process.env.API_TOKEN}` },
      httpAgent: this.agent,
    };
  }

  async get<T>(path: string, config: AxiosRequestConfig = {}) {
    return (await axios.get<T>(this.url(path), this.config(config))).data;
  }

  async send<T>(path: string, data: unknown, idempotencyKey?: string) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    const config = this.config({ timeout: SEND_TIMEOUT, headers });
    return (await axios.post<T>(this.url(path), data, config)).data;
  }
}
