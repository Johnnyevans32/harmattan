import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseObjectIdPipe } from '@/core/pipes/parse-object-id.pipe';
import {
  ApiDataResponse,
  ApiErrorResponse,
  ResponseService,
} from '@/core/response';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get(':walletId')
  @ApiOperation({
    summary: 'Get a wallet',
    description: 'A single-currency wallet with its balance and USD value.',
  })
  @ApiParam({ name: 'walletId', example: '6720c0f1a2b3c4d5e6f70813' })
  @ApiDataResponse(WalletResponseDto)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Wallet not found')
  async findOne(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @Res() res: Response,
  ): Promise<void> {
    const wallet = await this.walletService.findById(walletId);
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'Wallet retrieved successfully',
      wallet,
    );
  }
}
