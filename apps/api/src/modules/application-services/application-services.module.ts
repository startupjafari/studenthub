import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { DocumentsModule } from '../documents/documents.module'
import { ApplicationServicesController } from './application-services.controller'
import { ApplicationsController } from './applications.controller'
import { CatalogService } from './catalog.service'
import { ApplicationsService } from './applications.service'
import { ApplicationDocumentsService } from './application-documents.service'
import { ApplicationProcessService } from './application-process.service'
import { ApplicationPolicy } from './application.policy'

// Домен «Услуги университета» (переработка «Заявок»). PrismaService доступен глобально.
// FilesModule — presigned для файлов документов заявки. DocumentsModule — выдача готового
// документа-результата в кабинет студента (§17). Заменяет старый ApplicationsModule.
@Module({
  imports: [FilesModule, DocumentsModule],
  controllers: [ApplicationServicesController, ApplicationsController],
  providers: [
    CatalogService,
    ApplicationsService,
    ApplicationDocumentsService,
    ApplicationProcessService,
    ApplicationPolicy,
  ],
  exports: [ApplicationPolicy, CatalogService, ApplicationsService],
})
export class ApplicationServicesModule {}
