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
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { RoomService } from './rooms.service'
import { CreateRoomDto } from './dto/create-room.dto'
import { UpdateRoomDto } from './dto/update-room.dto'
import { RoomListQueryDto } from './dto/room-list-query.dto'

@ApiTags('Аудитории')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Создать аудиторию (свой вуз для UNIVERSITY_ADMIN)' })
  @ApiResponse({ status: 201, description: 'Аудитория создана' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRoomDto,
    @Req() req: FastifyRequest,
  ) {
    return this.rooms.create(user, dto, this.ctx(req))
  }

  @Get()
  @ApiOperation({ summary: 'Список аудиторий (по scope смотрящего)' })
  @ApiResponse({ status: 200, description: 'Страница аудиторий' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: RoomListQueryDto) {
    return this.rooms.list(user, query.page, query.limit, query.universityId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Аудитория (scope)' })
  @ApiResponse({ status: 200, description: 'Аудитория' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.rooms.getById(user, id)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Обновить аудиторию (название/вместимость)' })
  @ApiResponse({ status: 200, description: 'Аудитория обновлена' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
    @Req() req: FastifyRequest,
  ) {
    return this.rooms.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить аудиторию (только не занятую в расписании)' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  @ApiResponse({ status: 409, description: 'CONFLICT — используется в парах' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.rooms.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
