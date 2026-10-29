import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BaseSchema, BaseSchemaDecorator } from '@/core/base.schema';
import { DB_TABLE_NAMES } from '@/core/constants';
import { Stablecoin } from '@/enums/stablecoin.enum';

export type WalletDocument = HydratedDocument<Wallet>;

/** A single-currency balance owned by a user. */
@BaseSchemaDecorator()
export class Wallet extends BaseSchema {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLE_NAMES.USERS,
    required: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Stablecoin, required: true })
  currency!: Stablecoin;

  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    default: () => Types.Decimal128.fromString('0'),
  })
  balance!: Types.Decimal128;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// Exactly one wallet per user per coin.
WalletSchema.index({ userId: 1, currency: 1 }, { unique: true });
