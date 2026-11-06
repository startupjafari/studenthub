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
import { LibraryIdAccessController } from './library-id-access.controller'
import { LibraryIdAccessService } from './library-id-access.service'
import { LibraryRemindersService } from './library-reminders.service'
import { LibraryReservationsController } from './library-reservations.controller'
import { LibraryReservationsService } from './library-reservations.service'
import { LibraryDebtsController } from './library-debts.controller'
import { LibraryDebtsService } from './library-debts.service'
import { LibraryReportsController } from './library-reports.controller'
import { LibraryReportsService } from './library-reports.service'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Владеет таблицами `library_settings`,
// `books`, `book_copies`, `loans`, `reservations`, `library_id_access_logs`. FilesModule —
// обложки книг; StudentIdModule — сверка читателя по QR студенческого при выдаче.
@Module({
  imports: [FilesModule, StudentIdModule],
  controllers: [
    LibrarySettingsController,
    LibraryCatalogController,
    LibraryLoansController,
    LibraryIdAccessController,
    LibraryReservationsController,
    LibraryDebtsController,
    LibraryReportsController,
  ],
  providers: [
    LibrarySettingsService,
    LibraryCatalogService,
    LibraryImportService,
    LibraryLoansService,
    LibraryNotifier,
    LibraryIdAccessService,
    LibraryRemindersService,
    LibraryReservationsService,
    LibraryDebtsService,
    LibraryReportsService,
  ],
  exports: [LibrarySettingsService, LibraryRemindersService, LibraryReservationsService],
})
export class LibraryModule {}
