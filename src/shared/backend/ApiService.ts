import http from "http";
import axios, { AxiosRequestConfig } from "axios";

const SEND_TIMEOUT = 30 * 1000;

export class ApiService {
  private static instance: ApiService;

  private constructor(
    private client = axios.create({
      baseURL: process.env.API_URL,
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
      httpAgent: new http.Agent({ keepAlive: true }),
    })
  ) {}

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }

    return ApiService.instance;
  }

  async get<T>(path: string, config: AxiosRequestConfig = {}) {
    return (await this.client.get<T>(path, config)).data;
  }

  async send<T>(path: string, data: unknown, idempotencyKey?: string) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    return (await this.client.post<T>(path, data, { timeout: SEND_TIMEOUT, headers })).data;
  }
}
