import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { UsersModule } from '../users/users.module'
import { UniversitiesModule } from '../universities/universities.module'
import { DocumentTemplatesController } from './document-templates.controller'
import { DocumentTemplatesService } from './document-templates.service'

// DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»). Файлы — через
// FilesModule (приватный бакет documents), данные студента и вуза — у их модулей-владельцев.
// PrismaService/ConfigService/AuditService — глобальные.
@Module({
  imports: [FilesModule, UsersModule, UniversitiesModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
