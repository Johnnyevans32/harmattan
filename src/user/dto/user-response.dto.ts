import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WalletResponseDto } from '@/wallet/dto/wallet-response.dto';

export class UserResponseDto {
  @ApiProperty({ example: '6720c0f1a2b3c4d5e6f70812' })
  id!: string;

  @ApiPropertyOptional({ example: 'ada@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  phone?: string;

  @ApiProperty({
    type: [WalletResponseDto],
    description: 'One wallet per supported stablecoin',
  })
  wallets!: WalletResponseDto[];

  @ApiProperty({
    description: 'Sum of all wallet balances valued in USD at current rates',
    example: '1097.88',
  })
  totalUsd!: string;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  createdAt!: Date;
}
