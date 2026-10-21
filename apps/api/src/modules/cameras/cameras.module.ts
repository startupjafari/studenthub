import { Module } from '@nestjs/common'
import { RoomsModule } from '../rooms/rooms.module'
import { CameraAgentsService } from './camera-agents.service'
import { CamerasService } from './cameras.service'
import { CameraAgentsController } from './camera-agents.controller'
import { CamerasController } from './cameras.controller'
import { CameraAgentSyncController } from './camera-agent-sync.controller'
import { CameraAgentSyncService } from './camera-agent-sync.service'
import { CameraAgentSignal } from './camera-agent-signal'
import { AgentAuthGuard } from './agent-auth.guard'

// Камеры вуза (docs/PROJECT.md §3.10). Владеет таблицами `camera_agents`, `cameras`,
// `camera_settings`. RoomsModule — проверка, что помещение камеры из того же вуза.
// CameraAgentSyncController — вход самого агента (токен агента вместо JWT).
@Module({
  imports: [RoomsModule],
  controllers: [CameraAgentsController, CamerasController, CameraAgentSyncController],
  providers: [
    CameraAgentsService,
    CamerasService,
    CameraAgentSyncService,
    CameraAgentSignal,
    AgentAuthGuard,
  ],
})
export class CamerasModule {}
