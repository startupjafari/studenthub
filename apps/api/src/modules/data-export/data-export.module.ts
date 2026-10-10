import { Module } from '@nestjs/common'
import { DataExportController } from './data-export.controller'
import { DataExportService } from './data-export.service'

// Машинная выгрузка своих персональных данных (Ф14.6, docs/PERSONAL_DATA.md §5).
// Отдельный модуль, а не метод в users: перечень источников должен лежать в одном месте
// и читаться целиком — обоснование отступления от §2.1 см. в шапке сервиса.
// ExportBrandingModule глобальный (как Prisma и Audit) — импортировать его не нужно.
@Module({
  controllers: [DataExportController],
  providers: [DataExportService],
})
export class DataExportModule {}
