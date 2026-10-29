import { Injectable } from '@nestjs/common';
import configuration from '@/core/configuration';
import { RequestService } from '@/core/request';
import type {
  FxRateProvider,
  UsdRateTable,
} from './fx-rate-provider.interface';

interface OpenErApiResponse {
  result: 'success' | 'error';
  base_code: string;
  rates?: Record<string, number>;
  'error-type'?: string;
}

/** ExchangeRate-API open access endpoint: free, keyless, covers NGN/GHS/XAF. */
@Injectable()
export class OpenErApiProvider implements FxRateProvider {
  readonly name = 'open.er-api.com';
  private readonly url: string;
  private readonly http: RequestService;

  constructor() {
    const { fx } = configuration();
    this.url = fx.providerUrl;
    this.http = new RequestService({ timeout: fx.providerTimeoutMs });
  }

  async fetchUsdRates(): Promise<UsdRateTable> {
    const body = await this.http.request<OpenErApiResponse>({
      method: 'GET',
      url: this.url,
    });

    if (body.result !== 'success' || body.base_code !== 'USD' || !body.rates) {
      throw new Error(
        `Unexpected response from ${this.name}: ${body['error-type'] ?? body.result}`,
      );
    }

    return Object.fromEntries(
      Object.entries(body.rates).map(([code, rate]) => [code, String(rate)]),
    );
  }
}
