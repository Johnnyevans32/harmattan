import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { IsAmount } from '@/core/decorators/is-amount.decorator';
import { PaginateDTO } from '@/core/response';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { TransactionType } from '@/enums/transaction-type.enum';

export class DepositDto {
  @ApiProperty({
    description:
      "Decimal string in the wallet's currency, up to 6 decimal places",
    example: '250000.00',
  })
  @IsAmount()
  amount!: string;
}

export class SwapDto {
  @ApiProperty({
    enum: Stablecoin,
    description:
      "Coin to receive. Credited to the same user's wallet for that coin.",
    example: Stablecoin.USDX,
  })
  @IsEnum(Stablecoin)
  toCurrency!: Stablecoin;

  @ApiProperty({
    description: "Amount to sell, in this wallet's currency",
    example: '15000.00',
  })
  @IsAmount()
  amount!: string;
}

export class TransferDto {
  @ApiProperty({
    description:
      "Receiving wallet id (another user's). Its currency decides what the recipient gets; converted at the current FX rate when it differs.",
    example: '6720c0f1a2b3c4d5e6f70820',
  })
  @IsMongoId()
  recipientWalletId!: string;

  @ApiProperty({
    description: "Amount to send, in this wallet's currency",
    example: '50000.00',
  })
  @IsAmount()
  amount!: string;
}

export class TransactionQueryDto extends PaginateDTO {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({
    enum: Stablecoin,
    description: 'Matches either the source or the destination currency',
  })
  @IsOptional()
  @IsEnum(Stablecoin)
  currency?: Stablecoin;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO 8601)',
    example: '2026-10-01T00:00:00Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO 8601)',
    example: '2026-10-31T23:59:59Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}
