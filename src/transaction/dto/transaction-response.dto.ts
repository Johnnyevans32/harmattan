import { ApiProperty } from '@nestjs/swagger';
import { RateSource } from '@/enums/rate-source.enum';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { TransactionType } from '@/enums/transaction-type.enum';

export class TransactionResponseDto {
  @ApiProperty({ example: '6720c3a9a2b3c4d5e6f70a21' })
  id!: string;

  @ApiProperty({ enum: TransactionType })
  type!: TransactionType;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for deposits',
    example: '6720c0f1a2b3c4d5e6f70812',
  })
  senderUserId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for deposits',
    example: '6720c0f1a2b3c4d5e6f70813',
  })
  senderWalletId!: string | null;

  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70819' })
  receiverUserId!: string;

  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70821' })
  receiverWalletId!: string;

  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CNGN })
  sourceCurrency!: Stablecoin;

  @ApiProperty({ example: '50000.000000' })
  sourceAmount!: string;

  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CGHS })
  destinationCurrency!: Stablecoin;

  @ApiProperty({ example: '383.333333' })
  destinationAmount!: string;

  @ApiProperty({
    description: 'Rate applied (1 when no conversion)',
    example: '0.00766666666667',
  })
  rate!: string;

  @ApiProperty({
    enum: RateSource,
    nullable: true,
    description: 'Null when no conversion happened',
  })
  rateSource!: RateSource | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Freshness of the rate applied',
  })
  rateRefreshedAt!: Date | null;

  @ApiProperty({ example: '7f9c2ba4-e88f-4c3b-9d1a-2f4e6b8a0c11' })
  idempotencyKey!: string;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  createdAt!: Date;
}
