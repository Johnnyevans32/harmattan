import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseObjectIdPipe } from '@/core/pipes/parse-object-id.pipe';
import {
  ApiDataResponse,
  ApiErrorResponse,
  ResponseService,
} from '@/core/response';
import { CreateWalletDto } from './dto/wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a wallet',
    description:
      'Creates a multi-currency wallet with a zero balance in every supported stablecoin. An email or phone number can own only one wallet.',
  })
  @ApiDataResponse(WalletResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'Validation failed')
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    'A wallet already exists for this email',
  )
  async create(
    @Body() dto: CreateWalletDto,
    @Res() res: Response,
  ): Promise<void> {
    const wallet = await this.walletService.create(dto);
    return ResponseService.json(
      res,
      HttpStatus.CREATED,
      'Wallet created successfully',
      wallet,
    );
  }

  @Get(':walletId')
  @ApiOperation({
    summary: 'Get a wallet and its balances',
    description:
      'Returns every stablecoin balance plus the total equivalent in USD.',
  })
  @ApiParam({ name: 'walletId', example: '6720c0f1a2b3c4d5e6f70812' })
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
