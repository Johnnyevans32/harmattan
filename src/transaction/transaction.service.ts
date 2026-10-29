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
import type { WalletDocument } from '@/wallet/schemas/wallet.schema';
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

/** Canonical amount so "100" and "100.00" fingerprint identically. */
const normalise = (amount: string): string => toMoney(amount).toFixed();

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
    return this.executeOnce(
      walletId,
      idempotencyKey,
      { type: TransactionType.DEPOSIT, amount: normalise(dto.amount) },
      async (session) => {
        const wallet = await this.walletService.findByIdOrFail(
          walletId,
          session,
        );
        const amount = this.parseAmount(dto.amount, wallet.currency);

        await this.walletService.credit(wallet, amount, session);
        return this.movement(
          TransactionType.DEPOSIT,
          null,
          wallet,
          wallet.currency,
          amount,
        );
      },
    );
  }

  swap(
    walletId: string,
    dto: SwapDto,
    idempotencyKey: string,
  ): Promise<IdempotentResult> {
    return this.executeOnce(
      walletId,
      idempotencyKey,
      {
        type: TransactionType.SWAP,
        toCurrency: dto.toCurrency,
        amount: normalise(dto.amount),
      },
      async (session) => {
        const source = await this.walletService.findByIdOrFail(
          walletId,
          session,
        );
        if (source.currency === dto.toCurrency) {
          throw new BadRequestException(
            `This wallet already holds ${dto.toCurrency}; choose a different toCurrency`,
          );
        }
        const amount = this.parseAmount(dto.amount, source.currency);
        const destination = await this.walletService.findUserWallet(
          source.userId,
          dto.toCurrency,
          session,
        );

        const movement = this.movement(
          TransactionType.SWAP,
          source,
          destination,
          source.currency,
          amount,
        );
        await this.walletService.debit(source, amount, session);
        await this.walletService.credit(
          destination,
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
      throw new BadRequestException('Cannot transfer to the same wallet');
    }

    return this.executeOnce(
      walletId,
      idempotencyKey,
      {
        type: TransactionType.TRANSFER,
        recipientWalletId: dto.recipientWalletId,
        amount: normalise(dto.amount),
      },
      async (session) => {
        const source = await this.walletService.findByIdOrFail(
          walletId,
          session,
        );
        const recipient = await this.walletService.findByIdOrFail(
          dto.recipientWalletId,
          session,
          'Recipient wallet not found',
        );
        if (recipient.userId.equals(source.userId)) {
          throw new BadRequestException(
            'Cannot transfer between your own wallets; use a swap instead',
          );
        }
        const amount = this.parseAmount(dto.amount, source.currency);

        const movement = this.movement(
          TransactionType.TRANSFER,
          source,
          recipient,
          source.currency,
          amount,
        );
        await this.walletService.debit(source, amount, session);
        await this.walletService.credit(
          recipient,
          toMoney(movement.destinationAmount),
          session,
        );
        return movement;
      },
    );
  }

  /** History for one wallet or for all of a user's wallets. */
  async list(
    scope: { walletId: string } | { userId: string },
    query: TransactionQueryDto,
  ): Promise<{
    transactions: TransactionResponseDto[];
    metadata: PaginationMetaDataDto;
  }> {
    const { page, limit, type, currency, startDate, endDate } = query;
    const [sender, receiver] =
      'walletId' in scope
        ? ['senderWalletId', 'receiverWalletId']
        : ['senderUserId', 'receiverUserId'];
    const id = new Types.ObjectId(
      'walletId' in scope ? scope.walletId : scope.userId,
    );

    const conditions: FilterQuery<TransactionDocument>[] = [
      { $or: [{ [sender]: id }, { [receiver]: id }] },
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
    sender: WalletDocument | null,
    receiver: WalletDocument,
    sourceCurrency: Stablecoin,
    sourceAmount: Money,
  ): Movement {
    const destinationCurrency = receiver.currency;
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
      senderUserId: sender?.userId ?? null,
      senderWalletId: sender?._id ?? null,
      receiverUserId: receiver.userId,
      receiverWalletId: receiver._id,
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
      senderUserId: transaction.senderUserId?.toString() ?? null,
      senderWalletId: transaction.senderWalletId?.toString() ?? null,
      receiverUserId: transaction.receiverUserId.toString(),
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
