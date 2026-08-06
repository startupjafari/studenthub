import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

// Глобальный: PrismaService доступен во всех модулях без повторного импорта.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
