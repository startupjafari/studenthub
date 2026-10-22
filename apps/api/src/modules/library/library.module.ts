import { Module } from '@nestjs/common'
import { LibrarySettingsController } from './library-settings.controller'
import { LibrarySettingsService } from './library-settings.service'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Владеет таблицами `library_settings`,
// `books`, `book_copies`, `loans`, `reservations`, `library_id_access_logs`.
@Module({
  controllers: [LibrarySettingsController],
  providers: [LibrarySettingsService],
  exports: [LibrarySettingsService],
})
export class LibraryModule {}
