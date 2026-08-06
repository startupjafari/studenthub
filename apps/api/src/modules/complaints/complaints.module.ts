import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { ComplaintsService } from './complaints.service'
import { ComplaintsController } from './complaints.controller'

// Жалобы и модерация (docs/PROJECT.md §11, задачи Ф11). Владеет Complaint.
// UsersModule — UserService.setBlocked для блокировки нарушителя. QueueService — уведомление автору.
@Module({
  imports: [UsersModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
