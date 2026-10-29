import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLE_NAMES } from '@/core/constants';
import { WalletModule } from '@/wallet/wallet.module';
import { UserSchema } from './schemas/user.schema';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLE_NAMES.USERS, schema: UserSchema },
    ]),
    WalletModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
