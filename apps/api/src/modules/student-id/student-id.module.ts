import { Module } from '@nestjs/common'
import { StudentIdService } from './student-id.service'
import { StudentIdController } from './student-id.controller'

// Домен «Цифровой студенческий» (docs/ACADEMIC_CORE.md, задача 20).
@Module({
  controllers: [StudentIdController],
  providers: [StudentIdService],
  exports: [StudentIdService],
})
export class StudentIdModule {}
