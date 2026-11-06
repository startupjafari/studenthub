import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { PortfolioService } from './portfolio.service'
import { PortfolioController } from './portfolio.controller'

// Домен «Портфолио» (docs/ACADEMIC_CORE.md, задача 21).
// UsersModule — видимость профиля владельца: закрытый профиль прячет и портфолио.
@Module({
  imports: [UsersModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
