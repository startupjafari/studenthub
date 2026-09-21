import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { MiniAllowed } from '../../common/decorators/mini-allowed.decorator'
import { RequiresConfirmation } from '../../common/decorators/requires-confirmation.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { UserService } from './users.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateUsernameDto } from './dto/update-username.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { UserDirectoryQueryDto } from './dto/user-directory-query.dto'
import { BlockUserDto } from './dto/block-user.dto'

@ApiTags('Пользователи')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UserService,
    private readonly branding: ExportBrandingService,
  ) {}

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

  @Patch('me/username')
  @ApiOperation({ summary: 'Сменить имя пользователя (имя входа); 409 USERNAME_TAKEN если занято' })
  updateUsername(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateUsernameDto) {
    return this.users.updateUsername(user.sub, dto.username)
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
  // Мини-аппу открыт только поиск и карточка: с телефона человека находят, чтобы принять
  // решение о доступе. Выгрузка, импорт и правка профиля остаются в вебе.
  @MiniAllowed()
  @ApiOperation({
    summary: 'Список пользователей (Admin+, по scope; фильтры role/faculty/group/search)',
  })
  @ApiResponse({ status: 200, description: 'Страница пользователей' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: UserListQueryDto) {
    return this.users.list(user, query)
  }

  /**
   * Выгрузка списка в файл (задача 12.8). Фильтры — те же, что у `GET /users`, плюс
   * `format` (xlsx по умолчанию) и `locale` для подписей.
   *
   * Объявлен ДО `@Get(':id')`: параметрический маршрут перехватил бы /users/export.
   */
  @Get('export')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({ summary: 'Выгрузить список пользователей (XLSX/CSV, по scope и фильтрам)' })
  @ApiResponse({ status: 200, description: 'Файл выгрузки' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — строк больше предела выгрузки' })
  async export(
    @CurrentUser() user: CurrentUserData,
    @Query() query: UserListQueryDto,
    @Query('format') format: string | undefined,
    @Query('locale') locale: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const ext = format === 'csv' ? 'csv' : 'xlsx'
    const { body, filename } = await this.users.exportList(
      user,
      query,
      this.branding.resolveLocale(locale),
      ext,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    await reply
      .header('content-type', this.branding.contentType(ext))
      .header('content-disposition', this.branding.disposition(filename))
      .send(body)
  }

  // Объявлен ДО @Get(':id') — иначе параметрический маршрут перехватил бы /users/directory.
  @Get('directory')
  @ApiOperation({
    summary: 'Справочник людей своего вуза (визитки; секции друзья/группа/вуз) — все роли',
  })
  directory(@CurrentUser() user: CurrentUserData, @Query() query: UserDirectoryQueryDto) {
    return this.users.directory(user, query)
  }

  @Get(':id')
  @MiniAllowed()
  @ApiOperation({ summary: 'Профиль пользователя (email — по правам смотрящего)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.users.getProfileForViewer(id, user)
  }

  /**
   * Карточка для модератора: роль, вуз, доступ и счётчик жалоб на человека.
   *
   * Читается рядом с жалобой и обращением — там, где решение принимают про человека,
   * а видно только имя. Полный профиль (`GET /users/:id`) для этого слишком широк.
   */
  @Get(':id/moderation')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @MiniAllowed()
  @ApiOperation({ summary: 'Карточка пользователя для модератора (роль, вуз, блокировка, жалобы)' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — пользователь другого вуза' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  moderationCard(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.users.moderationCard(user, id)
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
  @MiniAllowed()
  // С телефона — только с кодом: отобрать человеку доступ нельзя промахом по экрану.
  @RequiresConfirmation()
  @ApiOperation({
    summary: 'Заблокировать пользователя (из мини-аппа — с кодом 2FA; blockDays — срок)',
  })
  async block(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: BlockUserDto | undefined,
  ): Promise<null> {
    // Со сроком блокировка снимется сама, без него — бессрочная, как была. Считаем срок
    // от момента блокировки: «на три дня», выданное вечером, кончается вечером через три дня.
    const until = dto?.blockDays ? new Date(Date.now() + dto.blockDays * 24 * 60 * 60 * 1000) : null
    await this.users.setBlocked(user, id, true, until)
    return null
  }

  @Patch(':id/logout')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @MiniAllowed()
  // Угнанный аккаунт до этого останавливали только блокировкой целиком — то есть
  // наказывали пострадавшего. Сброс сессий выгоняет чужого, оставляя доступ хозяину.
  @ApiOperation({ summary: 'Завершить все сессии пользователя (в своём scope)' })
  async logout(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.users.revokeSessions(user, id)
    return null
  }

  @Patch(':id/unblock')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @MiniAllowed()
  @ApiOperation({ summary: 'Разблокировать пользователя (в своём scope)' })
  async unblock(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.users.setBlocked(user, id, false)
    return null
  }
}
