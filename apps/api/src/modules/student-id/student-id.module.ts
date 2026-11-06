import { Module } from '@nestjs/common'
import { StudentIdService } from './student-id.service'
import { StudentIdController } from './student-id.controller'
import { SecurityJournalModule } from '../security-journal/security-journal.module'

// Домен «Цифровой студенческий» (docs/ACADEMIC_CORE.md, задача 20). Проверка охраной
// пишет проход в журнал поста (SecurityJournalModule).
@Module({
  imports: [SecurityJournalModule],
  controllers: [StudentIdController],
  providers: [StudentIdService],
  exports: [StudentIdService],
})
export class StudentIdModule {}
