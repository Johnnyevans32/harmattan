import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import configuration from '@/core/configuration';
import {
  DB_TABLE_NAMES,
  FALLBACK_RATES_AS_OF,
  FALLBACK_USD_RATES,
  FX_RATE_PROVIDER,
  STABLECOIN_CONFIG,
} from '@/core/constants';
import {
  convert,
  formatAmount,
  Money,
  roundRate,
  toDecimal128,
  toMoney,
} from '@/core/money';
import { RateSource } from '@/enums/rate-source.enum';
import { STABLECOINS, Stablecoin } from '@/enums/stablecoin.enum';
import type {
  FxQuoteResponseDto,
  FxRateResponseDto,
} from './dto/fx-response.dto';
import type { FxRateProvider } from './providers/fx-rate-provider.interface';
import type { FxRateDocument } from './schemas/fx-rate.schema';

interface UsdRate {
  unitsPerUsd: Money;
  source: RateSource;
  refreshedAt: Date;
}

export interface PairRate {
  from: Stablecoin;
  to: Stablecoin;
  rate: Money;
  source: RateSource;
  refreshedAt: Date;
}

/**
 * Rates are held in memory as units-per-USD and crossed through USD.
 *
 * Resolution order per coin:
 *   1. latest live quote (refreshed in the background),
 *   2. last known good live quote persisted in Mongo (survives restarts),
 *   3. the built-in fallback table.
 * A provider outage therefore never blocks swaps or transfers; it only makes
 * the reported `refreshedAt` older and eventually flips `stale` to true.
 */
@Injectable()
export class FxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FxService.name);
  private readonly config = configuration().fx;
  private readonly rates = new Map<Stablecoin, UsdRate>();
  private inFlightRefresh?: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(DB_TABLE_NAMES.FX_RATES)
    private readonly fxRateModel: Model<FxRateDocument>,
    @Inject(FX_RATE_PROVIDER)
    private readonly provider: FxRateProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadSnapshot();
    await this.refresh();

    if (this.config.refreshIntervalMs > 0) {
      this.timer = setInterval(
        () => void this.refresh(),
        this.config.refreshIntervalMs,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Refreshes from the provider; concurrent callers share one request. */
  refresh(): Promise<void> {
    this.inFlightRefresh ??= this.fetchFromProvider().finally(() => {
      this.inFlightRefresh = undefined;
    });
    return this.inFlightRefresh;
  }

  getRate(from: Stablecoin, to: Stablecoin): PairRate {
    const base = this.usdRate(from);
    const quote = this.usdRate(to);

    if (from === to) {
      return { from, to, rate: new Money(1), ...base };
    }

    const bothLive =
      base.source === RateSource.LIVE && quote.source === RateSource.LIVE;

    return {
      from,
      to,
      rate: roundRate(quote.unitsPerUsd.div(base.unitsPerUsd)),
      source: bothLive ? RateSource.LIVE : RateSource.FALLBACK,
      refreshedAt:
        base.refreshedAt < quote.refreshedAt
          ? base.refreshedAt
          : quote.refreshedAt,
    };
  }

  getAllRates(): FxRateResponseDto[] {
    return STABLECOINS.flatMap((from) =>
      STABLECOINS.filter((to) => to !== from).map((to) =>
        this.toResponse(this.getRate(from, to)),
      ),
    );
  }

  quote(from: Stablecoin, to: Stablecoin, amount: string): FxQuoteResponseDto {
    if (from === to) {
      throw new BadRequestException('from and to must be different currencies');
    }
    const pair = this.getRate(from, to);

    return {
      ...this.toResponse(pair),
      amount: formatAmount(amount, from),
      convertedAmount: formatAmount(
        convert(toMoney(amount), pair.rate, to),
        to,
      ),
    };
  }

  isStale(refreshedAt: Date): boolean {
    return Date.now() - refreshedAt.getTime() > this.config.maxRateAgeMs;
  }

  toResponse(pair: PairRate): FxRateResponseDto {
    return {
      from: pair.from,
      to: pair.to,
      rate: pair.rate.toFixed(),
      source: pair.source,
      refreshedAt: pair.refreshedAt,
      stale: this.isStale(pair.refreshedAt),
    };
  }

  private usdRate(currency: Stablecoin): UsdRate {
    const rate = this.rates.get(currency);
    if (!rate) {
      throw new Error(`FX rates not initialised for ${currency}`);
    }
    return rate;
  }

  private async loadSnapshot(): Promise<void> {
    const persisted = await this.fxRateModel.find().lean();
    const byCurrency = new Map(persisted.map((doc) => [doc.currency, doc]));

    for (const currency of STABLECOINS) {
      const doc = byCurrency.get(currency);
      this.rates.set(
        currency,
        doc
          ? {
              unitsPerUsd: toMoney(doc.unitsPerUsd),
              source: doc.source,
              refreshedAt: doc.refreshedAt,
            }
          : {
              unitsPerUsd: toMoney(FALLBACK_USD_RATES[currency]),
              source: RateSource.FALLBACK,
              refreshedAt: FALLBACK_RATES_AS_OF,
            },
      );
    }
  }

  private async fetchFromProvider(): Promise<void> {
    let table: Awaited<ReturnType<FxRateProvider['fetchUsdRates']>>;
    try {
      table = await this.provider.fetchUsdRates();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `FX refresh from ${this.provider.name} failed (${reason}); serving last known rates`,
      );
      return;
    }

    const refreshedAt = new Date();
    const updates = new Map<Stablecoin, UsdRate>();

    for (const currency of STABLECOINS) {
      const { fiat } = STABLECOIN_CONFIG[currency];
      const unitsPerUsd = this.parseRate(table[fiat]);
      if (!unitsPerUsd) {
        this.logger.warn(
          `${this.provider.name} returned no usable ${fiat} rate; keeping previous ${currency} rate`,
        );
        continue;
      }
      updates.set(currency, {
        unitsPerUsd,
        source: RateSource.LIVE,
        refreshedAt,
      });
    }

    if (updates.size === 0) return;

    updates.forEach((rate, currency) => this.rates.set(currency, rate));

    try {
      await this.fxRateModel.bulkWrite(
        [...updates].map(([currency, rate]) => ({
          updateOne: {
            filter: { currency },
            update: {
              $set: {
                unitsPerUsd: toDecimal128(rate.unitsPerUsd),
                source: rate.source,
                refreshedAt: rate.refreshedAt,
              },
            },
            upsert: true,
          },
        })),
      );
    } catch (error) {
      this.logger.error('Failed to persist FX rates', error);
    }

    this.logger.log(
      `Refreshed ${updates.size}/${STABLECOINS.length} FX rates from ${this.provider.name}`,
    );
  }

  private parseRate(value: string | undefined): Money | null {
    if (value === undefined) return null;
    try {
      const rate = toMoney(value);
      return rate.isFinite() && rate.gt(0) ? rate : null;
    } catch {
      return null;
    }
  }
}
