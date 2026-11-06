import { Module } from '@nestjs/common'
import { SecurityJournalController } from './security-journal.controller'
import { SecurityVisitorsService } from './security-visitors.service'
import { SecurityPassesService } from './security-passes.service'

// Журналы поста охраны (docs/PROJECT.md §3.12). Владеет таблицами `security_visitors` и
// `security_passes`. SecurityPassesService экспортируется: проход пишет проверка
// студенческого (StudentIdModule).
@Module({
  controllers: [SecurityJournalController],
  providers: [SecurityVisitorsService, SecurityPassesService],
  exports: [SecurityPassesService],
})
export class SecurityJournalModule {}
