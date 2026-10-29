import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLE_NAMES, FX_RATE_PROVIDER } from '@/core/constants';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { OpenErApiProvider } from './providers/open-er-api.provider';
import { FxRateSchema } from './schemas/fx-rate.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLE_NAMES.FX_RATES, schema: FxRateSchema },
    ]),
  ],
  controllers: [FxController],
  providers: [
    FxService,
    { provide: FX_RATE_PROVIDER, useClass: OpenErApiProvider },
  ],
  exports: [FxService],
})
export class FxModule {}
