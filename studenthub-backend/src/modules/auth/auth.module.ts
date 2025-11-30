import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/services/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { EmailVerificationService } from './services/email-verification.service';
import { TwoFactorService } from './services/2fa.service';

import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { LocalStrategy } from './strategies/local.strategy';

import { RedisModule } from '../../common/modules/redis.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const expiration = configService.get<string>('JWT_EXPIRATION') || '15m';
        return {
          secret: configService.get<string>('JWT_SECRET') || 'secret',
          signOptions: {
            expiresIn: expiration as any,
          },
        };
      },
      inject: [ConfigService],
    }),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    PasswordService,
    TokenService,
    EmailVerificationService,
    TwoFactorService,
    JwtStrategy,
    JwtRefreshStrategy,
    LocalStrategy,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}

