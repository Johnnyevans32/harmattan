import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Decimal from 'decimal.js';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import type { ClientSession, Model } from 'mongoose';
import { DB_TABLE_NAMES, VALUATION_CURRENCY } from '@/core/constants';
import { isDuplicateKeyError } from '@/core/helpers';
import { formatAmount, Money, toDecimal128, toMoney } from '@/core/money';
import { STABLECOINS, Stablecoin } from '@/enums/stablecoin.enum';
import { FxService } from '@/fx/fx.service';
import type { CreateWalletDto } from './dto/wallet.dto';
import type { WalletResponseDto } from './dto/wallet-response.dto';
import type { WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(DB_TABLE_NAMES.WALLETS)
    private readonly walletModel: Model<WalletDocument>,
    private readonly fxService: FxService,
  ) {}

  async create(dto: CreateWalletDto): Promise<WalletResponseDto> {
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone && parsePhoneNumberWithError(dto.phone).number;

    const existing = await this.walletModel
      .findOne({
        $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      })
      .lean();
    if (existing) {
      throw this.duplicateContactError(
        email && existing.email === email ? 'email' : 'phone',
      );
    }

    try {
      const wallet = await this.walletModel.create({ email, phone });
      return this.mapToResponse(wallet);
    } catch (error) {
      // Lost a race with a concurrent request for the same contact.
      if (isDuplicateKeyError(error)) {
        throw this.duplicateContactError(
          error.keyPattern && 'phone' in error.keyPattern ? 'phone' : 'email',
        );
      }
      throw error;
    }
  }

  async findById(walletId: string): Promise<WalletResponseDto> {
    const wallet = await this.walletModel.findById(walletId);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return this.mapToResponse(wallet);
  }

  async credit(
    walletId: string,
    currency: Stablecoin,
    amount: Money,
    session: ClientSession,
    notFoundMessage = 'Wallet not found',
  ): Promise<void> {
    const { matchedCount } = await this.walletModel.updateOne(
      { _id: walletId },
      { $inc: { [`balances.${currency}`]: toDecimal128(amount) } },
      { session },
    );
    if (matchedCount === 0) {
      throw new NotFoundException(notFoundMessage);
    }
  }

  /**
   * Atomic compare-and-decrement: the balance guard and the decrement are a
   * single server-side operation, so concurrent debits can never overdraw.
   */
  async debit(
    walletId: string,
    currency: Stablecoin,
    amount: Money,
    session: ClientSession,
  ): Promise<void> {
    const path = `balances.${currency}`;
    const { matchedCount } = await this.walletModel.updateOne(
      { _id: walletId, [path]: { $gte: toDecimal128(amount) } },
      { $inc: { [path]: toDecimal128(amount.neg()) } },
      { session },
    );
    if (matchedCount > 0) return;

    const exists = await this.walletModel
      .exists({ _id: walletId })
      .session(session);
    if (!exists) {
      throw new NotFoundException('Wallet not found');
    }
    throw new UnprocessableEntityException(`Insufficient ${currency} balance`);
  }

  private mapToResponse(wallet: WalletDocument): WalletResponseDto {
    let totalUsd = new Money(0);

    const balances = STABLECOINS.map((currency) => {
      const amount = toMoney(wallet.balances[currency]);
      const usdValue = amount.mul(
        this.fxService.getRate(currency, VALUATION_CURRENCY).rate,
      );
      totalUsd = totalUsd.add(usdValue);

      return {
        currency,
        amount: formatAmount(amount, currency),
        usdValue: usdValue.toFixed(2, Decimal.ROUND_HALF_EVEN),
      };
    });

    return {
      id: wallet.id as string,
      email: wallet.email,
      phone: wallet.phone,
      balances,
      totalUsd: totalUsd.toFixed(2, Decimal.ROUND_HALF_EVEN),
      createdAt: wallet.createdAt,
    };
  }

  private duplicateContactError(field: 'email' | 'phone'): ConflictException {
    return new ConflictException(`A wallet already exists for this ${field}`);
  }
}
