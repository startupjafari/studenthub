import { Module } from '@nestjs/common'
import { ApplicationServicesController } from './application-services.controller'
import { ApplicationsController } from './applications.controller'
import { CatalogService } from './catalog.service'
import { ApplicationsService } from './applications.service'
import { ApplicationPolicy } from './application.policy'

// Домен «Услуги университета» (переработка «Заявок»). PrismaService доступен глобально.
// Заменяет старый ApplicationsModule (снят с регистрации в AppModule; удаляется в cleanup).
@Module({
  controllers: [ApplicationServicesController, ApplicationsController],
  providers: [CatalogService, ApplicationsService, ApplicationPolicy],
  exports: [ApplicationPolicy, CatalogService],
})
export class ApplicationServicesModule {}
