import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { PollsService } from './polls.service'
import { PollsController } from './polls.controller'

// Опросы профиля (Poll/PollOption/PollVote). PrismaModule глобальный.
// UsersModule — видимость профиля автора (закрытый профиль скрывает и опросы).
@Module({
  imports: [UsersModule],
  controllers: [PollsController],
  providers: [PollsService],
  exports: [PollsService],
})
export class PollsModule {}
