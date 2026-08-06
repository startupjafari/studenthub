import { Module } from '@nestjs/common'
import { RoomService } from './rooms.service'
import { RoomsController } from './rooms.controller'

// Аудитории (docs/PROJECT.md §3.1, задача Ф6.4). Владеет таблицей `rooms`; экспортирует
// RoomService, чтобы SchedulesModule валидировал принадлежность аудитории вузу, не трогая таблицу напрямую.
@Module({
  controllers: [RoomsController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomsModule {}
