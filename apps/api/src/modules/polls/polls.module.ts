import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { CareerModule } from '../career/career.module'
import { PollsService } from './polls.service'
import { PollsController } from './polls.controller'

// Опросы профиля (Poll/PollOption/PollVote). PrismaModule и QueueModule (уведомление автору
// о комментарии) глобальные.
// UsersModule — видимость профиля автора (закрытый профиль скрывает и опросы).
// CareerModule — опросы страницы компании: её видимость и право публиковать от её имени.
@Module({
  imports: [UsersModule, CareerModule],
  controllers: [PollsController],
  providers: [PollsService],
  exports: [PollsService],
})
export class PollsModule {}
