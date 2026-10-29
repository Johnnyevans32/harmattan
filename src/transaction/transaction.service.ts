import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import {
  type ClientSession,
  type Connection,
  type FilterQuery,
  mongo,
  type PaginateModel,
  Types,
} from 'mongoose';
import { DB_TABLE_NAMES, IDEMPOTENCY_KEY_HEADER } from '@/core/constants';
import { isDuplicateKeyError } from '@/core/helpers';
import {
  convert,
  decimalsOf,
  formatAmount,
  Money,
  toDecimal128,
  toMoney,
} from '@/core/money';
import type { PaginationMetaDataDto } from '@/core/response';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { TransactionType } from '@/enums/transaction-type.enum';
import { FxService } from '@/fx/fx.service';
import { WalletService } from '@/wallet/wallet.service';
import type {
  DepositDto,
  SwapDto,
  TransactionQueryDto,
  TransferDto,
} from './dto/transaction.dto';
import type { TransactionResponseDto } from './dto/transaction-response.dto';
import type {
  Transaction,
  TransactionDocument,
} from './schemas/transaction.schema';

export interface IdempotentResult {
  transaction: TransactionResponseDto;
  /** True when an earlier identical request was replayed. */
  replayed: boolean;
}

type Movement = Omit<
  Transaction,
  'initiatorWalletId' | 'idempotencyKey' | 'requestHash' | 'createdAt'
>;

const TRANSACTION_OPTIONS: mongo.TransactionOptions = {
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
};

@Injectable()
export class TransactionService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DB_TABLE_NAMES.TRANSACTIONS)
    private readonly transactionModel: PaginateModel<TransactionDocument>,
    private readonly walletService: WalletService,
    private readonly fxService: FxService,
  ) {}

  deposit(
    walletId: string,
    dto: DepositDto,
    idempotencyKey: string,
  ): Promise<IdempotentResult> {
    const amount = this.parseAmount(dto.amount, dto.currency);

    return this.executeOnce(
      walletId,
      idempotencyKey,
      {
        type: TransactionType.DEPOSIT,
        currency: dto.currency,
        amount: amount.toFixed(),
      },
      async (session) => {
        await this.walletService.credit(
          walletId,
          dto.currency,
          amount,
          session,
        );

        return this.movement(
          TransactionType.DEPOSIT,
          null,
          walletId,
          dto.currency,
          amount,
          dto.currency,
        );
      },
    );
  }

  swap(
    walletId: string,
    dto: SwapDto,
    idempotencyKey: string,
  ): Promise<IdempotentResult> {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new BadRequestException(
        'fromCurrency and toCurrency must be different',
      );
    }
    const amount = this.parseAmount(dto.amount, dto.fromCurrency);

    return this.executeOnce(
      walletId,
      idempotencyKey,
      {
        type: TransactionType.SWAP,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        amount: amount.toFixed(),
      },
      async (session) => {
        const movement = this.movement(
          TransactionType.SWAP,
          walletId,
          walletId,
          dto.fromCurrency,
          amount,
          dto.toCurrency,
        );
        await this.walletService.debit(
          walletId,
          dto.fromCurrency,
          amount,
          session,
        );
        await this.walletService.credit(
          walletId,
          dto.toCurrency,
          toMoney(movement.destinationAmount),
          session,
        );
        return movement;
      },
    );
  }

  transfer(
    walletId: string,
    dto: TransferDto,
    idempotencyKey: string,
  ): Promise<IdempotentResult> {
    if (dto.recipientWalletId === walletId) {
      throw new BadRequestException(
        'Cannot transfer to the same wallet; use a swap instead',
      );
    }
    const destinationCurrency = dto.destinationCurrency ?? dto.sourceCurrency;
    const amount = this.parseAmount(dto.amount, dto.sourceCurrency);

    return this.executeOnce(
      walletId,
      idempotencyKey,
      {
        type: TransactionType.TRANSFER,
        recipientWalletId: dto.recipientWalletId,
        sourceCurrency: dto.sourceCurrency,
        destinationCurrency,
        amount: amount.toFixed(),
      },
      async (session) => {
        const movement = this.movement(
          TransactionType.TRANSFER,
          walletId,
          dto.recipientWalletId,
          dto.sourceCurrency,
          amount,
          destinationCurrency,
        );
        await this.walletService.debit(
          walletId,
          dto.sourceCurrency,
          amount,
          session,
        );
        await this.walletService.credit(
          dto.recipientWalletId,
          destinationCurrency,
          toMoney(movement.destinationAmount),
          session,
          'Recipient wallet not found',
        );
        return movement;
      },
    );
  }

  async list(
    walletId: string,
    query: TransactionQueryDto,
  ): Promise<{
    transactions: TransactionResponseDto[];
    metadata: PaginationMetaDataDto;
  }> {
    const { page, limit, type, currency, startDate, endDate } = query;
    const id = new Types.ObjectId(walletId);

    const conditions: FilterQuery<TransactionDocument>[] = [
      { $or: [{ senderWalletId: id }, { receiverWalletId: id }] },
    ];
    if (type) conditions.push({ type });
    if (currency) {
      conditions.push({
        $or: [{ sourceCurrency: currency }, { destinationCurrency: currency }],
      });
    }
    if (startDate || endDate) {
      conditions.push({
        createdAt: {
          ...(startDate && { $gte: startDate }),
          ...(endDate && { $lte: endDate }),
        },
      });
    }

    const { docs, totalDocs, totalPages, prevPage, nextPage } =
      await this.transactionModel.paginate(
        { $and: conditions },
        { page, limit, sort: { createdAt: -1, _id: -1 }, lean: false },
      );

    return {
      transactions: docs.map((doc) => this.mapToResponse(doc)),
      metadata: {
        page,
        limit,
        totalDocs,
        totalPages,
        prevPage: prevPage ?? null,
        nextPage: nextPage ?? null,
      },
    };
  }

  async findById(transactionId: string): Promise<TransactionResponseDto> {
    const transaction = await this.transactionModel.findById(transactionId);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return this.mapToResponse(transaction);
  }

  /**
   * Runs a money movement exactly once per (wallet, idempotency key).
   *
   * Balance updates and the transaction record commit atomically in one
   * Mongo transaction. A replayed key returns the stored result; a racing
   * duplicate either hits a write conflict (the driver retries, then sees the
   * committed record) or the unique index (handled below). Failed attempts
   * write nothing, so the client may safely retry them with the same key.
   */
  private async executeOnce(
    walletId: string,
    idempotencyKey: string,
    fingerprint: Record<string, string>,
    work: (session: ClientSession) => Promise<Movement>,
  ): Promise<IdempotentResult> {
    const initiatorWalletId = new Types.ObjectId(walletId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify(fingerprint))
      .digest('hex');

    const replay = (existing: TransactionDocument): IdempotentResult => {
      if (existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException(
          `${IDEMPOTENCY_KEY_HEADER} was already used for a different request`,
        );
      }
      return { transaction: this.mapToResponse(existing), replayed: true };
    };

    try {
      let result!: IdempotentResult;

      await this.connection.transaction(async (session) => {
        const existing = await this.transactionModel
          .findOne({ initiatorWalletId, idempotencyKey })
          .session(session);
        if (existing) {
          result = replay(existing);
          return;
        }

        const movement = await work(session);
        const [created] = await this.transactionModel.create(
          [{ ...movement, initiatorWalletId, idempotencyKey, requestHash }],
          { session },
        );
        result = { transaction: this.mapToResponse(created), replayed: false };
      }, TRANSACTION_OPTIONS);

      return result;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const existing = await this.transactionModel.findOne({
        initiatorWalletId,
        idempotencyKey,
      });
      if (!existing) throw error;
      return replay(existing);
    }
  }

  /** Prices a movement at the current rate. Same-currency moves use rate 1. */
  private movement(
    type: TransactionType,
    senderWalletId: string | null,
    receiverWalletId: string,
    sourceCurrency: Stablecoin,
    sourceAmount: Money,
    destinationCurrency: Stablecoin,
  ): Movement {
    const converts = sourceCurrency !== destinationCurrency;
    const pair = converts
      ? this.fxService.getRate(sourceCurrency, destinationCurrency)
      : null;
    const rate = pair?.rate ?? new Money(1);
    const destinationAmount = convert(sourceAmount, rate, destinationCurrency);

    if (destinationAmount.isZero()) {
      throw new BadRequestException(
        `Amount is too small to convert into ${destinationCurrency}`,
      );
    }

    return {
      type,
      senderWalletId: senderWalletId
        ? new Types.ObjectId(senderWalletId)
        : null,
      receiverWalletId: new Types.ObjectId(receiverWalletId),
      sourceCurrency,
      sourceAmount: toDecimal128(sourceAmount),
      destinationCurrency,
      destinationAmount: toDecimal128(destinationAmount),
      rate: toDecimal128(rate),
      rateSource: pair?.source ?? null,
      rateRefreshedAt: pair?.refreshedAt ?? null,
    };
  }

  /** Rejects amounts finer than the coin's smallest unit instead of silently truncating. */
  private parseAmount(value: string, currency: Stablecoin): Money {
    const amount = toMoney(value);
    if (amount.decimalPlaces() > decimalsOf(currency)) {
      throw new BadRequestException(
        `${currency} supports at most ${decimalsOf(currency)} decimal places`,
      );
    }
    return amount;
  }

  private mapToResponse(
    transaction: TransactionDocument,
  ): TransactionResponseDto {
    return {
      id: transaction.id as string,
      type: transaction.type,
      senderWalletId: transaction.senderWalletId?.toString() ?? null,
      receiverWalletId: transaction.receiverWalletId.toString(),
      sourceCurrency: transaction.sourceCurrency,
      sourceAmount: formatAmount(
        transaction.sourceAmount,
        transaction.sourceCurrency,
      ),
      destinationCurrency: transaction.destinationCurrency,
      destinationAmount: formatAmount(
        transaction.destinationAmount,
        transaction.destinationCurrency,
      ),
      rate: toMoney(transaction.rate).toFixed(),
      rateSource: transaction.rateSource,
      rateRefreshedAt: transaction.rateRefreshedAt,
      idempotencyKey: transaction.idempotencyKey,
      createdAt: transaction.createdAt,
    };
  }
}
