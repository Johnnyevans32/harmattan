import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Stablecoin } from '@/enums/stablecoin.enum';

export class BalanceResponseDto {
  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CNGN })
  currency!: Stablecoin;

  @ApiProperty({ example: '150000.000000' })
  amount!: string;

  @ApiProperty({ description: 'Equivalent value in USD', example: '97.88' })
  usdValue!: string;
}

export class WalletResponseDto {
  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70812' })
  id!: string;

  @ApiPropertyOptional({ example: 'ada@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  phone?: string;

  @ApiProperty({ type: [BalanceResponseDto] })
  balances!: BalanceResponseDto[];

  @ApiProperty({
    description: 'Sum of all balances valued in USD at current rates',
    example: '1097.88',
  })
  totalUsd!: string;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  createdAt!: Date;
}
