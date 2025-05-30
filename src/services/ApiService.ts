import http from "http";
import axios, { GenericAbortSignal } from "axios";
import { AmazonAdCategory, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class ApiService {
  private static instance: ApiService;
  categories: AmazonAdCategory[] = [];
  countries: Country[] = [];

  private constructor() {
    new CronJob("0 0 */1 * * *", async () => {
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

  async loadCountries() {
    this.get<Country[]>("countries").then((data) => {
      this.countries = data;
    });
  }

  async loadCategories() {
    this.get<AmazonAdCategory[]>("amazon/ads/categories").then((data) => {
      this.categories = data;
    });
  }

  private url(path: string) {
    return process.env.API_URL + "/" + path;
  }

  async get<T>(path: string) {
    const agent = new http.Agent({ keepAlive: true });
    return (await axios.get<T>(this.url(path), { httpAgent: agent })).data;
  }

  async post<T>(path: string, data: unknown) {
    const agent = new http.Agent({ keepAlive: true });
    return axios
      .post<T>(this.url(path), data, { httpAgent: agent })
      .catch((e) => {
        this.handleError(e);
      });
  }

  async put<T>(path: string, data: unknown, signal?: GenericAbortSignal) {
    const agent = new http.Agent({ keepAlive: true });
    return axios
      .put<T>(this.url(path), data, { httpAgent: agent, signal })
      .catch((e) => {
        this.handleError(e);
      });
  }

  async delete<T>(path: string) {
    const agent = new http.Agent({ keepAlive: true });
    return axios.delete<T>(this.url(path), { httpAgent: agent }).catch((e) => {
      this.handleError(e);
    });
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
