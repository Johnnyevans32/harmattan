import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

export class RequestService {
  private readonly $axios: AxiosInstance;

  constructor(config?: AxiosRequestConfig) {
    this.$axios = axios.create(config);
  }

  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const { data } = await this.$axios.request<T>(config);
    return data;
  }
}
