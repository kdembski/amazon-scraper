import http from "http";
import axios, { AxiosRequestConfig } from "axios";
import { ThrottledQueue } from "@/shared/http/ThrottledQueue";

export class ApiService {
  private static instance: ApiService;
  private writeQueue;
  private agent;

  private constructor(
    writeQueue = new ThrottledQueue(5, 25),
    agent = new http.Agent({ keepAlive: true })
  ) {
    this.writeQueue = writeQueue;
    this.agent = agent;
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

  async get<T>(path: string, config: AxiosRequestConfig = {}) {
    return (await axios.get<T>(this.url(path), { ...config, httpAgent: this.agent })).data;
  }

  async post<T>(path: string, data: unknown, config: AxiosRequestConfig = {}) {
    return axios
      .post<T>(this.url(path), data, { ...config, httpAgent: this.agent })
      .catch((e) => {
        this.handleError(e);
      });
  }

  async put<T>(path: string, data: unknown) {
    return this.writeQueue.request(() =>
      axios.put<T>(this.url(path), data, { httpAgent: this.agent }).catch((e) => {
        this.handleError(e);
      })
    );
  }

  async delete<T>(path: string) {
    return this.writeQueue.request(() =>
      axios.delete<T>(this.url(path), { httpAgent: this.agent }).catch((e) => {
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
