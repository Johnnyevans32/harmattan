import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import configuration from './core/configuration';
import { FxModule } from './fx/fx.module';
import { TransactionModule } from './transaction/transaction.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: configuration().database.url }),
    }),
    FxModule,
    UserModule,
    WalletModule,
    TransactionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
