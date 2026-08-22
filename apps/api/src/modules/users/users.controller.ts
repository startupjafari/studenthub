import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import { UserService } from './users.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'

@ApiTags('Пользователи')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Мой профиль' })
  me(@CurrentUser() user: CurrentUserData) {
    return this.users.findById(user.sub)
  }

  @Patch('me')
  @ApiOperation({ summary: 'Обновить свой профиль (имя, настройка приватности email)' })
  updateMe(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.sub, user.role, dto)
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Сменить пароль (разлогинивает все устройства)' })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
  ): Promise<null> {
    await this.users.changePassword(user.sub, dto.currentPassword, dto.newPassword)
    return null
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить аватар (изображение, ≤ 10 МБ)' })
  async setAvatar(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.users.setAvatar(user.sub, buffer)
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Удалить аватар' })
  removeAvatar(@CurrentUser() user: CurrentUserData) {
    return this.users.removeAvatar(user.sub)
  }

  @Post('me/cover')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить обложку профиля (изображение, ≤ 10 МБ)' })
  @ApiResponse({ status: 200, description: 'Профиль с обновлённой обложкой' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  async setCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.users.setCover(user.sub, buffer)
  }

  @Delete('me/cover')
  @ApiOperation({ summary: 'Удалить обложку профиля' })
  @ApiResponse({ status: 200, description: 'Профиль без обложки' })
  removeCover(@CurrentUser() user: CurrentUserData) {
    return this.users.removeCover(user.sub)
  }

  @Delete('me')
  @ApiOperation({ summary: 'Удалить свой аккаунт (soft delete + анонимизация)' })
  async deleteMe(@CurrentUser() user: CurrentUserData): Promise<null> {
    await this.users.softDeleteSelf(user.sub)
    return null
  }

  @Get()
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({
    summary: 'Список пользователей (Admin+, по scope; фильтры role/faculty/group/search)',
  })
  @ApiResponse({ status: 200, description: 'Страница пользователей' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: UserListQueryDto) {
    return this.users.list(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Профиль пользователя (email — по правам смотрящего)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.users.getProfileForViewer(id, user)
  }

  @Get(':id/presence')
  @ApiOperation({ summary: 'Статус присутствия пользователя (в сети / не в сети)' })
  getPresence(@Param('id') id: string) {
    return this.users.getPresence(id)
  }

  @Patch(':id/block')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @ApiOperation({ summary: 'Заблокировать пользователя (в своём scope)' })
  async block(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.users.setBlocked(user, id, true)
    return null
  }

  @Patch(':id/unblock')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @ApiOperation({ summary: 'Разблокировать пользователя (в своём scope)' })
  async unblock(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.users.setBlocked(user, id, false)
    return null
  }
}
