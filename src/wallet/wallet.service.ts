import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Decimal from 'decimal.js';
import type { ClientSession, Model, Types } from 'mongoose';
import { DB_TABLE_NAMES, VALUATION_CURRENCY } from '@/core/constants';
import { formatAmount, Money, toDecimal128, toMoney } from '@/core/money';
import { STABLECOINS, Stablecoin } from '@/enums/stablecoin.enum';
import { FxService } from '@/fx/fx.service';
import type { WalletResponseDto } from './dto/wallet-response.dto';
import type { WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(DB_TABLE_NAMES.WALLETS)
    private readonly walletModel: Model<WalletDocument>,
    private readonly fxService: FxService,
  ) {}

  /** Opens one zero-balance wallet per supported coin for a new user. */
  async createForUser(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<WalletDocument[]> {
    return this.walletModel.create(
      STABLECOINS.map((currency) => ({ userId, currency })),
      { session, ordered: true },
    );
  }

  async findByIdOrFail(
    walletId: string,
    session?: ClientSession,
    notFoundMessage = 'Wallet not found',
  ): Promise<WalletDocument> {
    const wallet = await this.walletModel
      .findById(walletId)
      .session(session ?? null);
    if (!wallet) {
      throw new NotFoundException(notFoundMessage);
    }
    return wallet;
  }

  async findUserWallet(
    userId: Types.ObjectId,
    currency: Stablecoin,
    session: ClientSession,
  ): Promise<WalletDocument> {
    const wallet = await this.walletModel
      .findOne({ userId, currency })
      .session(session);
    if (!wallet) {
      throw new NotFoundException(`No ${currency} wallet found for this user`);
    }
    return wallet;
  }

  /** The user's wallets in canonical coin order. */
  async findByUser(userId: Types.ObjectId): Promise<WalletDocument[]> {
    const wallets = await this.walletModel.find({ userId });
    return wallets.sort(
      (a, b) =>
        STABLECOINS.indexOf(a.currency) - STABLECOINS.indexOf(b.currency),
    );
  }

  async findById(walletId: string): Promise<WalletResponseDto> {
    return this.mapToResponse(await this.findByIdOrFail(walletId));
  }

  async credit(
    wallet: WalletDocument,
    amount: Money,
    session: ClientSession,
  ): Promise<void> {
    const { matchedCount } = await this.walletModel.updateOne(
      { _id: wallet._id },
      { $inc: { balance: toDecimal128(amount) } },
      { session },
    );
    if (matchedCount === 0) {
      throw new NotFoundException('Wallet not found');
    }
  }

  /**
   * Atomic compare-and-decrement: the balance guard and the decrement are a
   * single server-side operation, so concurrent debits can never overdraw.
   */
  async debit(
    wallet: WalletDocument,
    amount: Money,
    session: ClientSession,
  ): Promise<void> {
    const { matchedCount } = await this.walletModel.updateOne(
      { _id: wallet._id, balance: { $gte: toDecimal128(amount) } },
      { $inc: { balance: toDecimal128(amount.neg()) } },
      { session },
    );
    if (matchedCount === 0) {
      throw new UnprocessableEntityException(
        `Insufficient ${wallet.currency} balance`,
      );
    }
  }

  usdValueOf(wallet: WalletDocument): Money {
    return toMoney(wallet.balance).mul(
      this.fxService.getRate(wallet.currency, VALUATION_CURRENCY).rate,
    );
  }

  mapToResponse(wallet: WalletDocument): WalletResponseDto {
    return {
      id: wallet.id as string,
      userId: wallet.userId.toString(),
      currency: wallet.currency,
      balance: formatAmount(wallet.balance, wallet.currency),
      usdValue: formatUsd(this.usdValueOf(wallet)),
      createdAt: wallet.createdAt,
    };
  }
}

export const formatUsd = (value: Money): string =>
  value.toFixed(2, Decimal.ROUND_HALF_EVEN);
