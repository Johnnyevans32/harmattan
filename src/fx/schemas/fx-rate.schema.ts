import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BaseSchema, BaseSchemaDecorator } from '@/core/base.schema';
import { RateSource } from '@/enums/rate-source.enum';
import { Stablecoin } from '@/enums/stablecoin.enum';

export type FxRateDocument = HydratedDocument<FxRate>;

/** Last known good live rate per coin, expressed as units per 1 USD. */
@BaseSchemaDecorator()
export class FxRate extends BaseSchema {
  @Prop({ type: String, enum: Stablecoin, required: true, unique: true })
  currency!: Stablecoin;

  @Prop({ type: SchemaTypes.Decimal128, required: true })
  unitsPerUsd!: Types.Decimal128;

  @Prop({ type: String, enum: RateSource, required: true })
  source!: RateSource;

  @Prop({ type: Date, required: true })
  refreshedAt!: Date;
}

export const FxRateSchema = SchemaFactory.createForClass(FxRate);
