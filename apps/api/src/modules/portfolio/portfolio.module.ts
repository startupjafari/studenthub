import { Module } from '@nestjs/common'
import { PortfolioService } from './portfolio.service'
import { PortfolioController } from './portfolio.controller'

// Домен «Портфолио» (docs/ACADEMIC_CORE.md, задача 21).
@Module({
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
