import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { IsAmount } from '@/core/decorators/is-amount.decorator';
import { Stablecoin } from '@/enums/stablecoin.enum';

export class FxQuoteQueryDto {
  @ApiProperty({ enum: Stablecoin, example: Stablecoin.USDX })
  @IsEnum(Stablecoin)
  from!: Stablecoin;

  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CNGN })
  @IsEnum(Stablecoin)
  to!: Stablecoin;

  @ApiProperty({ description: 'Amount in `from` currency', example: '100.00' })
  @IsAmount()
  amount!: string;
}
