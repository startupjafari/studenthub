import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { ApplicationServicesController } from './application-services.controller'
import { ApplicationsController } from './applications.controller'
import { CatalogService } from './catalog.service'
import { ApplicationsService } from './applications.service'
import { ApplicationDocumentsService } from './application-documents.service'
import { ApplicationPolicy } from './application.policy'

// Домен «Услуги университета» (переработка «Заявок»). PrismaService доступен глобально.
// FilesModule — presigned для файлов документов заявки. Заменяет старый ApplicationsModule.
@Module({
  imports: [FilesModule],
  controllers: [ApplicationServicesController, ApplicationsController],
  providers: [CatalogService, ApplicationsService, ApplicationDocumentsService, ApplicationPolicy],
  exports: [ApplicationPolicy, CatalogService],
})
export class ApplicationServicesModule {}
