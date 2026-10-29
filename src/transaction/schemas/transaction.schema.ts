import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, SchemaTypes, Types } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { BaseSchemaDecorator } from '@/core/base.schema';
import { DB_TABLE_NAMES } from '@/core/constants';
import { RateSource } from '@/enums/rate-source.enum';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { TransactionType } from '@/enums/transaction-type.enum';

export type TransactionDocument = HydratedDocument<Transaction>;

/**
 * Immutable record of one money movement. Every type uses the same shape:
 *   DEPOSIT   sender = null,   receiver = wallet
 *   SWAP      sender = wallet, receiver = wallet
 *   TRANSFER  sender = wallet, receiver = recipient
 */
@BaseSchemaDecorator({ timestamps: { createdAt: true, updatedAt: false } })
export class Transaction {
  @Prop({ type: String, enum: TransactionType, required: true })
  type!: TransactionType;

  /** Wallet whose API call created this record; scopes the idempotency key. */
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLE_NAMES.WALLETS,
    required: true,
  })
  initiatorWalletId!: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLE_NAMES.WALLETS,
    default: null,
  })
  senderWalletId!: Types.ObjectId | null;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLE_NAMES.WALLETS,
    required: true,
  })
  receiverWalletId!: Types.ObjectId;

  @Prop({ type: String, enum: Stablecoin, required: true })
  sourceCurrency!: Stablecoin;

  @Prop({ type: SchemaTypes.Decimal128, required: true })
  sourceAmount!: Types.Decimal128;

  @Prop({ type: String, enum: Stablecoin, required: true })
  destinationCurrency!: Stablecoin;

  @Prop({ type: SchemaTypes.Decimal128, required: true })
  destinationAmount!: Types.Decimal128;

  /** Exact rate applied: destinationAmount = truncate(sourceAmount * rate). */
  @Prop({ type: SchemaTypes.Decimal128, required: true })
  rate!: Types.Decimal128;

  /** Only set when a currency conversion happened. */
  @Prop({ type: String, enum: RateSource, default: null })
  rateSource!: RateSource | null;

  @Prop({ type: Date, default: null })
  rateRefreshedAt!: Date | null;

  @Prop({ type: String, required: true })
  idempotencyKey!: string;

  /** SHA-256 of the normalised request, to detect key reuse with a different payload. */
  @Prop({ type: String, required: true })
  requestHash!: string;

  createdAt!: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.plugin(mongoosePaginate);

TransactionSchema.index(
  { initiatorWalletId: 1, idempotencyKey: 1 },
  { unique: true },
);
TransactionSchema.index({ senderWalletId: 1, createdAt: -1, _id: -1 });
TransactionSchema.index({ receiverWalletId: 1, createdAt: -1, _id: -1 });
