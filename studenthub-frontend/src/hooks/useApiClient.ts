import { useCallback } from "react";
import type { AxiosRequestConfig } from "axios";

import { api } from "@/lib/api/axios";

type Params = Record<string, unknown> | URLSearchParams | undefined;

export const useApiClient = () => {
  const get = useCallback(
    async <T>(url: string, params?: Params, config?: AxiosRequestConfig) => {
      const response = await api.get<T>(url, { ...config, params });
      return response.data;
    },
    [],
  );

  const post = useCallback(
    async <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
      const response = await api.post<T>(url, data, config);
      return response.data;
    },
    [],
  );

  const put = useCallback(
    async <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
      const response = await api.put<T>(url, data, config);
      return response.data;
    },
    [],
  );

  const patch = useCallback(
    async <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
      const response = await api.patch<T>(url, data, config);
      return response.data;
    },
    [],
  );

  const del = useCallback(
    async <T>(url: string, config?: AxiosRequestConfig) => {
      const response = await api.delete<T>(url, config);
      return response.data;
    },
    [],
  );

  const upload = useCallback(
    async <T>(url: string, formData: FormData, config?: AxiosRequestConfig) => {
      const response = await api.post<T>(url, formData, config);
      return response.data;
    },
    [],
  );

  return { get, post, put, patch, del, upload };
};
