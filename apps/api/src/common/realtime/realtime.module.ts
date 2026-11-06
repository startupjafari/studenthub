import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { EnvVars } from '../../config/env.schema'
import { UniversitiesModule } from '../../modules/universities/universities.module'
import { RealtimeGateway } from './realtime.gateway'

// Общий WS-транспорт (docs/PROJECT.md §9). Глобальный: RealtimeGateway доступен любому
// модулю (NotificationsProcessor Ф3.4, ChatGateway Ф9) без повторного импорта.
// JWT для проверки handshake — тот же access-секрет, что и у HTTP (JwtStrategy).
// UniversitiesModule — UniversityAccessService: допуск по статусу вуза тот же, что у HTTP,
// и с той же памятью статуса (один экземпляр на процесс, его сбрасывает смена статуса).
@Global()
@Module({
  imports: [
    UniversitiesModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
