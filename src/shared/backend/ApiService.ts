import http from "http";
import axios, { AxiosRequestConfig } from "axios";
import { ThrottledQueue } from "@/shared/http/ThrottledQueue";

export class ApiService {
  private static instance: ApiService;
  private writeQueue;

  private constructor(writeQueue = new ThrottledQueue(5, 25)) {
    this.writeQueue = writeQueue;
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }

    return ApiService.instance;
  }

  private url(path: string) {
    return process.env.API_URL + "/" + path;
  }

  async get<T>(path: string) {
    const agent = new http.Agent({ keepAlive: true });
    return (await axios.get<T>(this.url(path), { httpAgent: agent })).data;
  }

  async post<T>(path: string, data: unknown, config: AxiosRequestConfig = {}) {
    const agent = new http.Agent({ keepAlive: true });
    return axios
      .post<T>(this.url(path), data, { ...config, httpAgent: agent })
      .catch((e) => {
        this.handleError(e);
      });
  }

  async put<T>(path: string, data: unknown) {
    const agent = new http.Agent({ keepAlive: true });
    return this.writeQueue.request(() =>
      axios.put<T>(this.url(path), data, { httpAgent: agent }).catch((e) => {
        this.handleError(e);
      })
    );
  }

  async delete<T>(path: string) {
    const agent = new http.Agent({ keepAlive: true });
    return this.writeQueue.request(() =>
      axios.delete<T>(this.url(path), { httpAgent: agent }).catch((e) => {
        this.handleError(e);
      })
    );
  }

  private handleError(e: any) {
    const { status, message, cause, response } = e;
    console.error("Server:");
    if (status) console.error("  " + status);
    if (message) console.error("  " + message);
    if (cause) console.error("  " + cause.toString());
    if (response?.data)
      console.error("  " + response.data.replaceAll("\n", " "));
  }
}
