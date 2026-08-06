import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { ApplicationsService } from './applications.service'
import { ApplicationsController } from './applications.controller'

// Заявки в деканат (docs/PROJECT.md §3.2, задачи Ф7). Владеет ApplicationRequest/History.
// FilesModule — вложения через FileService (бакет applications). QueueService (уведомления) — глобальный.
@Module({
  imports: [FilesModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
