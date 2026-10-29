import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IDEMPOTENT_REPLAY_HEADER } from '@/core/constants';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '@/core/decorators/idempotency-key.decorator';
import { ParseObjectIdPipe } from '@/core/pipes/parse-object-id.pipe';
import {
  ApiDataResponse,
  ApiErrorResponse,
  ResponseService,
} from '@/core/response';
import {
  DepositDto,
  SwapDto,
  TransactionQueryDto,
  TransferDto,
} from './dto/transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import {
  type IdempotentResult,
  TransactionService,
} from './transaction.service';

const WALLET_ID_PARAM = {
  name: 'walletId',
  example: '6720c0f1a2b3c4d5e6f70812',
};

/** Shared OpenAPI docs for the three idempotent money-moving endpoints. */
const MoneyMovementDocs = () =>
  applyDecorators(
    ApiTags('Money Movement'),
    ApiParam(WALLET_ID_PARAM),
    ApiIdempotencyKey(),
    ApiDataResponse(TransactionResponseDto, {
      status: HttpStatus.CREATED,
      description: 'Processed',
    }),
    ApiDataResponse(TransactionResponseDto, {
      description: `Idempotent replay of an earlier identical request (${IDEMPOTENT_REPLAY_HEADER}: true)`,
    }),
    ApiErrorResponse(
      HttpStatus.BAD_REQUEST,
      'Validation failed or Idempotency-Key missing',
    ),
    ApiErrorResponse(HttpStatus.NOT_FOUND, 'Wallet not found'),
    ApiErrorResponse(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Insufficient balance, or key reused with a different payload',
    ),
  );

@Controller('wallets/:walletId')
export class WalletTransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('deposits')
  @ApiOperation({
    summary: 'Deposit funds (simulated)',
    description:
      'Credits the wallet immediately and records a DEPOSIT transaction.',
  })
  @MoneyMovementDocs()
  async deposit(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: DepositDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.transactionService.deposit(
      walletId,
      dto,
      idempotencyKey,
    );
    return this.respond(res, result, 'Deposit successful');
  }

  @Post('swaps')
  @ApiOperation({
    summary: 'Swap between stablecoins',
    description:
      'Converts an amount of one coin into another inside the same wallet at the current FX rate. Rejected if the source balance is insufficient.',
  })
  @MoneyMovementDocs()
  async swap(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: SwapDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.transactionService.swap(
      walletId,
      dto,
      idempotencyKey,
    );
    return this.respond(res, result, 'Swap successful');
  }

  @Post('transfers')
  @ApiOperation({
    summary: 'Send funds to another wallet',
    description:
      'Debits the sender in sourceCurrency and credits the recipient in destinationCurrency, converting at the current FX rate when they differ.',
  })
  @MoneyMovementDocs()
  async transfer(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: TransferDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.transactionService.transfer(
      walletId,
      dto,
      idempotencyKey,
    );
    return this.respond(res, result, 'Transfer successful');
  }

  @Get('transactions')
  @ApiTags('Transactions')
  @ApiOperation({
    summary: "List a wallet's transactions",
    description:
      'Deposits, swaps and transfers sent or received, newest first. Filter by type, currency (source or destination) and date range.',
  })
  @ApiParam(WALLET_ID_PARAM)
  @ApiDataResponse(TransactionResponseDto, { paginated: true })
  async list(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @Query() query: TransactionQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { transactions, metadata } = await this.transactionService.list(
      walletId,
      query,
    );
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'Transactions retrieved successfully',
      transactions,
      metadata,
    );
  }

  private respond(
    res: Response,
    { transaction, replayed }: IdempotentResult,
    message: string,
  ): void {
    if (replayed) {
      res.setHeader(IDEMPOTENT_REPLAY_HEADER, 'true');
      return ResponseService.json(
        res,
        HttpStatus.OK,
        `${message} (idempotent replay)`,
        transaction,
      );
    }
    return ResponseService.json(res, HttpStatus.CREATED, message, transaction);
  }
}

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Get(':transactionId')
  @ApiOperation({ summary: 'Get a transaction by id' })
  @ApiParam({ name: 'transactionId', example: '6720c3a9a2b3c4d5e6f70a21' })
  @ApiDataResponse(TransactionResponseDto)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Transaction not found')
  async findOne(
    @Param('transactionId', ParseObjectIdPipe) transactionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const transaction = await this.transactionService.findById(transactionId);
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'Transaction retrieved successfully',
      transaction,
    );
  }
}
