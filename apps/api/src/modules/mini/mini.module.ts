import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { MiniController } from './mini.controller'
import { MiniService } from './mini.service'

// Вход в админский мини-апп (docs/PROJECT.md §8.3).
//
// Модуль намеренно тонкий: он умеет только обменять подпись Telegram на короткий токен.
// Рабочие операции — жалобы, блокировки — живут в своих модулях и помечены @MiniAllowed();
// дублировать их здесь значило бы завести второй набор правил доступа к тем же данным.
//
// Prisma, аудит и Redis — глобальные модули; JwtModule приходит из AuthModule.
@Module({
  imports: [AuthModule],
  controllers: [MiniController],
  providers: [MiniService],
})
export class MiniModule {}
