import { Module } from '@nestjs/common'
import { RoomsModule } from '../rooms/rooms.module'
import { CameraAgentsService } from './camera-agents.service'
import { CamerasService } from './cameras.service'
import { CameraAgentsController } from './camera-agents.controller'
import { CamerasController } from './cameras.controller'

// Камеры вуза (docs/PROJECT.md §3.10). Владеет таблицами `camera_agents`, `cameras`,
// `camera_settings`. RoomsModule — проверка, что помещение камеры из того же вуза.
@Module({
  imports: [RoomsModule],
  controllers: [CameraAgentsController, CamerasController],
  providers: [CameraAgentsService, CamerasService],
})
export class CamerasModule {}
