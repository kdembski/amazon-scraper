import { RequestQueueService } from "@/services/RequestQueueService";
import http from "http";
import axios from "axios";

export class ApiService {
  private static instance: ApiService;
  queueService;

  private constructor(queueService = new RequestQueueService(5, false, this)) {
    this.queueService = queueService;
    queueService.start();
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

  get<T>(
    path: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    return this.queueService.request(() => {
      const agent = new http.Agent({ keepAlive: true });

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(this.url(path), {
            httpAgent: agent,
            adapter: "fetch",
            fetchOptions: { priority: "high" },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
            this.handleError(e);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  post<T>(
    path: string,
    data: unknown,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    return this.queueService.request(() => {
      const agent = new http.Agent({ keepAlive: true });

      return new Promise<void>(async (resolve) => {
        return axios
          .post<T>(this.url(path), data, {
            httpAgent: agent,
            adapter: "fetch",
            fetchOptions: { priority: "high" },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
            this.handleError(e);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  put<T>(
    path: string,
    data: unknown,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    return this.queueService.request(() => {
      const agent = new http.Agent({ keepAlive: true });

      return new Promise<void>(async (resolve) => {
        return axios
          .put<T>(this.url(path), data, {
            httpAgent: agent,
            adapter: "fetch",
            fetchOptions: { priority: "high" },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
            this.handleError(e);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  delete<T>(
    path: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    return this.queueService.request(() => {
      const agent = new http.Agent({ keepAlive: true });

      return new Promise<void>(async (resolve) => {
        return axios
          .delete<T>(this.url(path), {
            httpAgent: agent,
            adapter: "fetch",
            fetchOptions: { priority: "high" },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
            this.handleError(e);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  private handleError(e: any) {
    const { status, message, cause, response } = e;
    console.log("Server:");
    if (status) console.log("  " + status);
    if (message) console.log("  " + message);
    if (cause) console.log("  " + cause.toString());
    if (response?.data) console.log("  " + response.data.replaceAll("\n", " "));
  }
}
