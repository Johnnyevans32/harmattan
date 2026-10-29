import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLE_NAMES } from '@/core/constants';
import { FxModule } from '@/fx/fx.module';
import { WalletModule } from '@/wallet/wallet.module';
import { TransactionSchema } from './schemas/transaction.schema';
import {
  TransactionController,
  WalletTransactionController,
} from './transaction.controller';
import { TransactionService } from './transaction.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLE_NAMES.TRANSACTIONS, schema: TransactionSchema },
    ]),
    WalletModule,
    FxModule,
  ],
  controllers: [WalletTransactionController, TransactionController],
  providers: [TransactionService],
})
export class TransactionModule {}
