import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { DocumentsService } from './documents.service'
import { DocumentsController } from './documents.controller'
import { DocumentRequestsService } from './document-requests.service'
import { DocumentRequestsController } from './document-requests.controller'
import { DocumentTypesService } from './document-types.service'
import { DocumentTypesController } from './document-types.controller'
import { DocumentJournalService } from './document-journal.service'
import { DocumentJournalController } from './document-journal.controller'
import { DocumentEvents } from './document-events'

// Модуль «Документы» (Ф15). FilesModule — загрузка/presigned/удаление файлов документов
// (приватный бакет documents). PrismaService/ConfigService/AuditService — глобальные.
// Под-фаза C: запросы вуза (DocumentRequests*). Под-фаза D: типы документов (DocumentTypes*).
// DocumentEvents — живой сигнал `document.changed` (RealtimeModule глобальный).
@Module({
  imports: [FilesModule],
  controllers: [
    DocumentsController,
    DocumentRequestsController,
    DocumentTypesController,
    DocumentJournalController,
  ],
  providers: [
    DocumentsService,
    DocumentRequestsService,
    DocumentTypesService,
    DocumentJournalService,
    DocumentEvents,
  ],
  // DocumentRequestsService — для ночного закрытия запросов по сроку (closeOverdue) из cleanup.
  exports: [DocumentsService, DocumentRequestsService],
})
export class DocumentsModule {}
