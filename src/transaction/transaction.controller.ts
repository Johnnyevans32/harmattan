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
import { UserService } from '@/user/user.service';
import { WalletService } from '@/wallet/wallet.service';
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
  example: '6720c0f1a2b3c4d5e6f70813',
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

const HistoryDocs = (summary: string, description: string) =>
  applyDecorators(
    ApiTags('Transactions'),
    ApiOperation({ summary, description }),
    ApiDataResponse(TransactionResponseDto, { paginated: true }),
    ApiErrorResponse(HttpStatus.BAD_REQUEST, 'Invalid query'),
  );

@Controller('wallets/:walletId')
export class WalletTransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletService: WalletService,
  ) {}

  @Post('deposits')
  @ApiOperation({
    summary: 'Deposit funds (simulated)',
    description:
      "Credits the wallet immediately, in the wallet's currency, and records a DEPOSIT transaction.",
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
    summary: 'Swap into another coin',
    description:
      "Sells an amount from this wallet and credits the same user's toCurrency wallet at the current FX rate. Rejected if the balance is insufficient.",
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
    summary: "Send funds to another user's wallet",
    description:
      'Debits this wallet and credits the recipient wallet. When the two wallets hold different coins, the amount is converted at the current FX rate.',
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
  @HistoryDocs(
    "List a wallet's transactions",
    'Deposits, swaps and transfers in or out of this wallet, newest first. Filter by type, currency (source or destination) and date range.',
  )
  @ApiParam(WALLET_ID_PARAM)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Wallet not found')
  async list(
    @Param('walletId', ParseObjectIdPipe) walletId: string,
    @Query() query: TransactionQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.walletService.findByIdOrFail(walletId);
    const { transactions, metadata } = await this.transactionService.list(
      { walletId },
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

@Controller('users/:userId/transactions')
export class UserTransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @HistoryDocs(
    "List a user's transactions",
    "Everything across all of the user's wallets — deposits, swaps, transfers sent and received — newest first. Filter by type, currency and date range.",
  )
  @ApiParam({ name: 'userId', example: '6720c0f1a2b3c4d5e6f70812' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'User not found')
  async list(
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Query() query: TransactionQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.userService.findByIdOrFail(userId);
    const { transactions, metadata } = await this.transactionService.list(
      { userId },
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
