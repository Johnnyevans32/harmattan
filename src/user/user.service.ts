import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import type { Connection, Model } from 'mongoose';
import { DB_TABLE_NAMES } from '@/core/constants';
import { isDuplicateKeyError } from '@/core/helpers';
import { Money } from '@/core/money';
import type { WalletDocument } from '@/wallet/schemas/wallet.schema';
import { formatUsd, WalletService } from '@/wallet/wallet.service';
import type { CreateUserDto } from './dto/user.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import type { UserDocument } from './schemas/user.schema';

@Injectable()
export class UserService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DB_TABLE_NAMES.USERS)
    private readonly userModel: Model<UserDocument>,
    private readonly walletService: WalletService,
  ) {}

  /** Creates the user and one wallet per coin atomically. */
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone && parsePhoneNumberWithError(dto.phone).number;

    const existing = await this.userModel
      .findOne({
        $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      })
      .lean();
    if (existing) {
      throw this.duplicateContactError(
        email && existing.email === email ? 'email' : 'phone',
      );
    }

    try {
      let user!: UserDocument;
      let wallets: WalletDocument[] = [];

      await this.connection.transaction(async (session) => {
        [user] = await this.userModel.create([{ email, phone }], { session });
        wallets = await this.walletService.createForUser(user._id, session);
      });

      return this.mapToResponse(user, wallets);
    } catch (error) {
      // Lost a race with a concurrent request for the same contact.
      if (isDuplicateKeyError(error)) {
        throw this.duplicateContactError(
          error.keyPattern && 'phone' in error.keyPattern ? 'phone' : 'email',
        );
      }
      throw error;
    }
  }

  async findById(userId: string): Promise<UserResponseDto> {
    const user = await this.findByIdOrFail(userId);
    return this.mapToResponse(
      user,
      await this.walletService.findByUser(user._id),
    );
  }

  async findByIdOrFail(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private mapToResponse(
    user: UserDocument,
    wallets: WalletDocument[],
  ): UserResponseDto {
    const totalUsd = wallets.reduce(
      (sum, wallet) => sum.add(this.walletService.usdValueOf(wallet)),
      new Money(0),
    );

    return {
      id: user.id as string,
      email: user.email,
      phone: user.phone,
      wallets: wallets.map((wallet) =>
        this.walletService.mapToResponse(wallet),
      ),
      totalUsd: formatUsd(totalUsd),
      createdAt: user.createdAt,
    };
  }

  private duplicateContactError(field: 'email' | 'phone'): ConflictException {
    return new ConflictException(`A user already exists for this ${field}`);
  }
}
