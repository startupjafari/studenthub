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
  Query,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SecurityAllowed } from '../../common/decorators/security-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CamerasService } from './cameras.service'
import { CameraListQueryDto } from './dto/camera-list-query.dto'
import { CreateCameraDto } from './dto/create-camera.dto'
import { UpdateCameraDto } from './dto/update-camera.dto'
import { UpdateCameraSettingsDto } from './dto/update-camera-settings.dto'

// Камеры вуза (docs/PROJECT.md §3.10). Смотрят админ вуза и охрана, управляет админ.
@ApiTags('Камеры')
@ApiBearerAuth()
@Controller('cameras')
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  @Get()
  @Roles(Role.UNIVERSITY_ADMIN, Role.SECURITY_GUARD)
  @SecurityAllowed()
  @ApiOperation({
    summary: 'Камеры своего вуза: охране — включённые и без адресов, админу — все с подробностями',
  })
  list(@CurrentUser() user: CurrentUserData, @Query() query: CameraListQueryDto) {
    return this.cameras.list(user, query)
  }

  // ВНИМАНИЕ: `settings` объявлен ДО `:id` — иначе Fastify сматчит его на параметрический
  // маршрут.

  @Get('settings')
  @Roles(Role.UNIVERSITY_ADMIN, Role.SECURITY_GUARD)
  @SecurityAllowed()
  @ApiOperation({ summary: 'Включён ли модуль камер вуза' })
  settings(@CurrentUser() user: CurrentUserData) {
    return this.cameras.settings(user)
  }

  @Patch('settings')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Включить или выключить камеры вуза разом' })
  updateSettings(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateCameraSettingsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.cameras.updateSettings(user, dto, this.ctx(req))
  }

  @Post()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Добавить камеру; пароль сразу шифруется ключом агента' })
  @ApiResponse({ status: 201, description: 'Камера; пароль в ответ не возвращается' })
  @ApiResponse({
    status: 409,
    description:
      'CONFLICT (details.field=agentId) — агент ещё не прислал ключ, пароль не зашифровать',
  })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCameraDto,
    @Req() req: FastifyRequest,
  ) {
    return this.cameras.create(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Изменить камеру; credentials: null — убрать пароль' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет такой камеры в вашем вузе' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
    @Req() req: FastifyRequest,
  ) {
    return this.cameras.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить камеру' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.cameras.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
