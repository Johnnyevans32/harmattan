import { ApiProperty } from '@nestjs/swagger';
import { Stablecoin } from '@/enums/stablecoin.enum';

export class WalletResponseDto {
  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70813' })
  id!: string;

  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70812' })
  userId!: string;

  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CNGN })
  currency!: Stablecoin;

  @ApiProperty({ example: '150000.000000' })
  balance!: string;

  @ApiProperty({ description: 'Equivalent value in USD', example: '97.88' })
  usdValue!: string;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  createdAt!: Date;
}
