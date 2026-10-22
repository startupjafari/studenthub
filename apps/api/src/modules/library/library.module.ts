import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { StudentIdModule } from '../student-id/student-id.module'
import { LibrarySettingsController } from './library-settings.controller'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryCatalogController } from './library-catalog.controller'
import { LibraryCatalogService } from './library-catalog.service'
import { LibraryImportService } from './library-import.service'
import { LibraryLoansController } from './library-loans.controller'
import { LibraryLoansService } from './library-loans.service'
import { LibraryNotifier } from './library-notifier'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Владеет таблицами `library_settings`,
// `books`, `book_copies`, `loans`, `reservations`, `library_id_access_logs`. FilesModule —
// обложки книг; StudentIdModule — сверка читателя по QR студенческого при выдаче.
@Module({
  imports: [FilesModule, StudentIdModule],
  controllers: [LibrarySettingsController, LibraryCatalogController, LibraryLoansController],
  providers: [
    LibrarySettingsService,
    LibraryCatalogService,
    LibraryImportService,
    LibraryLoansService,
    LibraryNotifier,
  ],
  exports: [LibrarySettingsService],
})
export class LibraryModule {}
