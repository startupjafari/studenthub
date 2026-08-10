import { forwardRef, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import type { EnvVars } from '../../config/env.schema'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { ScopeGuard } from '../../common/guards/scope.guard'
import { UsersModule } from '../users/users.module'
import { InvitesModule } from '../invites/invites.module'
import { AuthController } from './auth.controller'
import { TwoFactorController } from './two-factor.controller'
import { AuthService } from './auth.service'
import { TwoFactorService } from './two-factor.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { LocalStrategy } from './strategies/local.strategy'

// Три барьера регистрируются глобально в строгом порядке: Jwt → Roles → Scope (§6.1).
// forwardRef(UsersModule) — разрешённое кольцо Auth ↔ Users (§2.1).
@Module({
  imports: [
    PassportModule,
    forwardRef(() => UsersModule),
    InvitesModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    TwoFactorService,
    JwtStrategy,
    LocalStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
