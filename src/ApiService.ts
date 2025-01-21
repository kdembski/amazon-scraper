import axios from "axios";

export class ApiService {
  private static instance: ApiService;
  private constructor() {}

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
    }
  ) {
    return new Promise<T>(async (resolve) => {
      return axios
        .get<T>(this.url(path))
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
        })
        .catch((e) => {
          callback?.onError?.(e);
          this.handleError(e);
        })
        .finally(() => {
          callback?.onFinally?.();
        });
    });
  }

  post<T>(
    path: string,
    data: unknown,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    }
  ) {
    return new Promise<T>(async (resolve) => {
      return axios
        .post<T>(this.url(path), data)
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
        })
        .catch((e) => {
          callback?.onError?.(e);
          //this.handleError(e);
        })
        .finally(() => {
          callback?.onFinally?.();
        });
    });
  }

  put<T>(
    path: string,
    data: unknown,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    }
  ) {
    return new Promise<T>(async (resolve) => {
      return axios
        .put<T>(this.url(path), data)
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
        })
        .catch((e) => {
          callback?.onError?.(e);
          //this.handleError(e);
        })
        .finally(() => {
          callback?.onFinally?.();
        });
    });
  }

  private handleError(e: any) {
    console.error(e?.response?.data.replaceAll("\n", " "));
  }
}
