import { Module } from '@nestjs/common'
import { PollsService } from './polls.service'
import { PollsController } from './polls.controller'

// Опросы профиля (Poll/PollOption/PollVote). PrismaModule глобальный.
@Module({
  controllers: [PollsController],
  providers: [PollsService],
  exports: [PollsService],
})
export class PollsModule {}
