import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { LibrarySettingsController } from './library-settings.controller'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryCatalogController } from './library-catalog.controller'
import { LibraryCatalogService } from './library-catalog.service'
import { LibraryImportService } from './library-import.service'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Владеет таблицами `library_settings`,
// `books`, `book_copies`, `loans`, `reservations`, `library_id_access_logs`. FilesModule —
// обложки книг.
@Module({
  imports: [FilesModule],
  controllers: [LibrarySettingsController, LibraryCatalogController],
  providers: [LibrarySettingsService, LibraryCatalogService, LibraryImportService],
  exports: [LibrarySettingsService],
})
export class LibraryModule {}
