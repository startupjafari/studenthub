import { Module } from '@nestjs/common'
import { ApplicationServicesController } from './application-services.controller'
import { CatalogService } from './catalog.service'
import { ApplicationPolicy } from './application.policy'

// Домен «Услуги университета» (переработка «Заявок»). PrismaService доступен глобально.
// ApplicationPolicy экспортируется — им пользуются guard/сервис заявок (следующий шаг).
@Module({
  controllers: [ApplicationServicesController],
  providers: [CatalogService, ApplicationPolicy],
  exports: [ApplicationPolicy, CatalogService],
})
export class ApplicationServicesModule {}
