import { Prop, raw, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BaseSchema, BaseSchemaDecorator } from '@/core/base.schema';
import { STABLECOINS, Stablecoin } from '@/enums/stablecoin.enum';

export type WalletDocument = HydratedDocument<Wallet>;
export type Balances = Record<Stablecoin, Types.Decimal128>;

const zero = () => Types.Decimal128.fromString('0');

@BaseSchemaDecorator()
export class Wallet extends BaseSchema {
  @Prop({ type: String, lowercase: true, trim: true })
  email?: string;

  /** E.164, e.g. +2348012345678 */
  @Prop({ type: String, trim: true })
  phone?: string;

  /**
   * One exact-decimal balance per coin, embedded so every debit is a single
   * atomic, conditional document update.
   */
  @Prop(
    raw(
      Object.fromEntries(
        STABLECOINS.map((currency) => [
          currency,
          { type: SchemaTypes.Decimal128, required: true, default: zero },
        ]),
      ),
    ),
  )
  balances!: Balances;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// A contact can own at most one wallet. Partial (not sparse) indexes so
// wallets created with only one of the two identifiers never collide.
WalletSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
WalletSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
