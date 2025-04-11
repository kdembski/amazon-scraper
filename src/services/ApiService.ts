import { RequestQueueService } from "@/services/RequestQueueService";
import http from "http";
import axios from "axios";
import { AmazonAdCategory, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class ApiService {
  private static instance: ApiService;
  queueService;
  categories: AmazonAdCategory[] = [];
  countries: Country[] = [];

  private constructor(queueService = new RequestQueueService(5, false)) {
    this.queueService = queueService;
    queueService.start();

    new CronJob("0 0 0 * * *", async () => {
      await this.loadCountries();
      await this.loadCategories();
    }).start();
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }

    return ApiService.instance;
  }

  async getCountries() {
    if (!this.countries.length) {
      await this.loadCountries();
    }

    return this.countries;
  }

  async getCategories() {
    if (!this.categories.length) {
      await this.loadCategories();
    }

    return this.categories;
  }

  loadCountries() {
    return this.get<Country[]>("countries", {
      onSuccess: (countries) => {
        this.countries = countries;
      },
    });
  }

  loadCategories() {
    return this.get<AmazonAdCategory[]>("amazon/ads/categories", {
      onSuccess: (categories) => {
        this.categories = categories;
      },
    });
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
          .get<T>(this.url(path), { httpAgent: agent })
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
          .post<T>(this.url(path), data, { httpAgent: agent })
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
          .put<T>(this.url(path), data, { httpAgent: agent })
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
          .delete<T>(this.url(path), { httpAgent: agent })
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
    // const { status, message, cause, response } = e;
    // console.log("Server:");
    // if (status) console.log("  " + status);
    // if (message) console.log("  " + message);
    // if (cause) console.log("  " + cause.toString());
    // if (response?.data) console.log("  " + response.data.replaceAll("\n", " "));
  }
}
