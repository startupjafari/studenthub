import { Module } from '@nestjs/common'
import { RoomService } from './rooms.service'
import { RoomQrService } from './room-qr.service'
import { RoomsController } from './rooms.controller'

// Помещения (docs/PROJECT.md §3.1, §3.9; задачи Ф6.4 и Ф16). Владеет таблицей `rooms`; экспортирует
// RoomService, чтобы SchedulesModule валидировал принадлежность аудитории вузу, не трогая таблицу напрямую.
// RoomQrService — печатные QR помещений и статус помещения по коду из QR.
@Module({
  controllers: [RoomsController],
  providers: [RoomService, RoomQrService],
  exports: [RoomService],
})
export class RoomsModule {}
