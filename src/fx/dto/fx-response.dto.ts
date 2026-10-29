import { ApiProperty } from '@nestjs/swagger';
import { RateSource } from '@/enums/rate-source.enum';
import { Stablecoin } from '@/enums/stablecoin.enum';

export class FxRateResponseDto {
  @ApiProperty({ enum: Stablecoin, example: Stablecoin.USDX })
  from!: Stablecoin;

  @ApiProperty({ enum: Stablecoin, example: Stablecoin.CNGN })
  to!: Stablecoin;

  @ApiProperty({
    description: 'Units of `to` received per 1 unit of `from`',
    example: '1532.45',
  })
  rate!: string;

  @ApiProperty({
    enum: RateSource,
    description: 'LIVE only when both legs come from the live provider',
  })
  source!: RateSource;

  @ApiProperty({
    description: 'When the older of the two legs was last refreshed',
    example: '2026-10-29T12:00:00.000Z',
  })
  refreshedAt!: Date;

  @ApiProperty({
    description: 'True when the rate is older than the freshness threshold',
  })
  stale!: boolean;
}

export class FxQuoteResponseDto extends FxRateResponseDto {
  @ApiProperty({ example: '100.000000' })
  amount!: string;

  @ApiProperty({
    description: 'Amount in `to` currency, truncated to its smallest unit',
    example: '153245.000000',
  })
  convertedAmount!: string;
}
