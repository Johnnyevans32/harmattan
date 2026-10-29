import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLE_NAMES } from '@/core/constants';
import { FxModule } from '@/fx/fx.module';
import { UserModule } from '@/user/user.module';
import { WalletModule } from '@/wallet/wallet.module';
import { TransactionSchema } from './schemas/transaction.schema';
import {
  TransactionController,
  UserTransactionController,
  WalletTransactionController,
} from './transaction.controller';
import { TransactionService } from './transaction.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLE_NAMES.TRANSACTIONS, schema: TransactionSchema },
    ]),
    UserModule,
    WalletModule,
    FxModule,
  ],
  controllers: [
    WalletTransactionController,
    UserTransactionController,
    TransactionController,
  ],
  providers: [TransactionService],
})
export class TransactionModule {}
