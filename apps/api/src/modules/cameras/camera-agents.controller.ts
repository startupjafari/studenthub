import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CameraAgentsService } from './camera-agents.service'
import { CreateCameraAgentDto } from './dto/create-camera-agent.dto'
import { UpdateCameraAgentDto } from './dto/update-camera-agent.dto'

// Агенты камер вуза (docs/PROJECT.md §3.10): только админ своего вуза.
@ApiTags('Камеры')
@ApiBearerAuth()
@Roles(Role.UNIVERSITY_ADMIN)
@Controller('camera-agents')
export class CameraAgentsController {
  constructor(private readonly agents: CameraAgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Агенты камер своего вуза: на связи ли, готов ли ключ, сколько камер' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.agents.list(user)
  }

  @Post()
  @ApiOperation({ summary: 'Завести агента; токен в ответе показывается один раз' })
  @ApiResponse({ status: 201, description: '{ agent, token }' })
  @ApiResponse({ status: 409, description: 'CONFLICT — достигнут предел агентов вуза' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCameraAgentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.agents.create(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Переименовать агента' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет такого агента в вашем вузе' })
  rename(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateCameraAgentDto,
  ) {
    return this.agents.rename(user, id, dto)
  }

  @Post(':id/token')
  @ApiOperation({
    summary: 'Перевыпустить токен агента: прежний гаснет, пароли камер нужно ввести заново',
  })
  @ApiResponse({ status: 201, description: '{ agent, token }' })
  rotateToken(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.agents.rotateToken(user, id, this.ctx(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить агента вместе с его камерами' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.agents.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
