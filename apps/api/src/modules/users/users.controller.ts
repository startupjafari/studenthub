import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { RESTRICTED_ROLES, Role } from '@studenthub/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { MiniAllowed } from '../../common/decorators/mini-allowed.decorator'
import { RequiresConfirmation } from '../../common/decorators/requires-confirmation.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import {
  ACTION_CONFIRMATION,
  type ActionConfirmation,
} from '../../common/auth/confirmation.constants'
import { readSingleUpload } from '../../common/http/read-upload'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { UserService } from './users.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateUsernameDto } from './dto/update-username.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { UserDirectoryQueryDto } from './dto/user-directory-query.dto'
import { BlockUserDto } from './dto/block-user.dto'
import { UpdateAcademicRecordDto } from './dto/update-academic-record.dto'
import { ResetTwoFactorDto } from './dto/reset-two-factor.dto'
import { DeleteAccountDto } from './dto/delete-account.dto'
import { AcceptConsentDto } from './dto/accept-consent.dto'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'

@ApiTags('Пользователи')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UserService,
    private readonly branding: ExportBrandingService,
    // Проверка кода второго фактора — по токену, а не классом TwoFactorService: прямой
    // импорт замыкает кольцо файлов auth ↔ users и валит запуск (confirmation.constants.ts).
    @Inject(ACTION_CONFIRMATION) private readonly confirmation: ActionConfirmation,
  ) {}

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Get('me')
  @ApiOperation({ summary: 'Мой профиль' })
  me(@CurrentUser() user: CurrentUserData) {
    return this.users.findById(user.sub)
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Patch('me')
  @ApiOperation({ summary: 'Обновить свой профиль (имя, настройка приватности email)' })
  updateMe(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.sub, user.role, dto)
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Get('me/consent')
  @ApiOperation({
    summary:
      'Согласие на обработку ПДн: действующая редакция документов и нужно ли принять заново (required)',
  })
  @ApiResponse({ status: 200, description: 'Состояние согласия владельца' })
  consent(@CurrentUser() user: CurrentUserData) {
    return this.users.consentState(user.sub)
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Post('me/consent')
  @ApiOperation({
    summary:
      'Принять действующую редакцию документов (повторное согласие; до 18 лет — законный представитель)',
  })
  @ApiResponse({ status: 201, description: 'Согласие записано; в ответе — новое состояние' })
  @ApiResponse({
    status: 400,
    description: 'BAD_REQUEST — нет даты рождения или согласия законного представителя',
  })
  acceptConsent(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: AcceptConsentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.users.acceptConsent(user.sub, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Patch('me/username')
  @ApiOperation({ summary: 'Сменить имя пользователя (имя входа); 409 USERNAME_TAKEN если занято' })
  updateUsername(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateUsernameDto) {
    return this.users.updateUsername(user.sub, dto.username)
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Patch('me/password')
  @ApiOperation({ summary: 'Сменить пароль (разлогинивает все устройства)' })
  @ApiResponse({ status: 200, description: 'Пароль изменён, все сессии погашены' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — неверный текущий пароль' })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMIT — 5 неверных текущих паролей за 15 минут, проверка закрыта',
  })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.users.changePassword(user.sub, dto.currentPassword, dto.newPassword, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    return null
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
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

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Delete('me/avatar')
  @ApiOperation({ summary: 'Удалить аватар' })
  removeAvatar(@CurrentUser() user: CurrentUserData) {
    return this.users.removeAvatar(user.sub)
  }

  @RestrictedAllowed(...RESTRICTED_ROLES)
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

  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Delete('me/cover')
  @ApiOperation({ summary: 'Удалить обложку профиля' })
  @ApiResponse({ status: 200, description: 'Профиль без обложки' })
  removeCover(@CurrentUser() user: CurrentUserData) {
    return this.users.removeCover(user.sub)
  }

  /**
   * Удаление своего аккаунта — только с повторной аутентификацией: текущий пароль и, если
   * включена 2FA, её код (TOTP или резервный). Необратимое действие раньше выполнял любой,
   * у кого в руках открытая вкладка или access-токен. Последнего администратора платформы
   * удалить нельзя: его выдаёт только сид, инвайтом нового не завести.
   */
  @RestrictedAllowed(...RESTRICTED_ROLES)
  @Delete('me')
  @ApiOperation({
    summary:
      'Удалить свой аккаунт (soft delete + анонимизация); в теле — текущий пароль и код 2FA, если она включена',
  })
  // Схема тела — явно: DTO с `.default({})` (запрос без тела) Swagger разбирает в пустой объект.
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        password: { type: 'string', description: 'Текущий пароль (обязателен)' },
        code: {
          type: 'string',
          description: 'Код 2FA — TOTP или резервный (обязателен, если 2FA включена)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Аккаунт удалён, сессии погашены' })
  @ApiResponse({
    status: 400,
    description: 'BAD_REQUEST — пароль не передан или неверен; не передан код 2FA',
  })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE — неверный код 2FA' })
  @ApiResponse({ status: 409, description: 'CONFLICT — последний администратор платформы' })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMIT — слишком много неверных паролей или кодов',
  })
  async deleteMe(
    @CurrentUser() user: CurrentUserData,
    // Тип — сам DTO, без `| undefined`: объединение уходит в метаданные как Object, и
    // ZodValidationPipe пропускал бы тело без проверки. Запрос без тела схема превращает в {}.
    @Body() dto: DeleteAccountDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.users.deleteOwnAccount(
      user.sub,
      { password: dto.password, code: dto.code },
      (code) => this.confirmation.verifyForUser(user.sub, code),
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
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
  // Книга до 5000 строк собирается синхронно, в event loop: несколько выгрузок подряд держали
  // процесс. Пять в минуту с пользователя хватает человеку и не хватает на такой залп.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Выгрузить список пользователей (XLSX/CSV, по scope и фильтрам)' })
  @ApiResponse({ status: 200, description: 'Файл выгрузки' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — строк больше предела выгрузки' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — больше 5 выгрузок в минуту' })
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
  @ApiOperation({
    summary: 'Статус присутствия (в сети / не в сети): человек своего вуза или друг',
  })
  getPresence(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.users.getPresenceFor(user, id)
  }

  @Patch(':id/academic')
  @Roles(Role.DEAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({
    summary: 'Учебные данные студента (декан своего факультета, админ своего вуза)',
  })
  @ApiResponse({ status: 200, description: 'Учебные данные студента (без номера студенческого)' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — студент вне области' })
  updateAcademic(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateAcademicRecordDto,
    @Req() req: FastifyRequest,
  ) {
    return this.users.updateAcademicRecord(user, id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
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
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        blockDays: { type: 'integer', minimum: 1, maximum: 365, description: 'Срок, дней' },
        code: { type: 'string', description: 'Код 2FA (мини-апп)' },
      },
    },
  })
  async block(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    // Без `| undefined`: объединение уходило в метаданные как Object, и срок (1–365 дней)
    // не проверялся вовсе. Запрос без тела (веб) схема превращает в {} — `.default({})`.
    @Body() dto: BlockUserDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    // Со сроком блокировка снимется сама, без него — бессрочная, как была. Считаем срок
    // от момента блокировки: «на три дня», выданное вечером, кончается вечером через три дня.
    const until = dto.blockDays ? new Date(Date.now() + dto.blockDays * 24 * 60 * 60 * 1000) : null
    await this.users.setBlocked(user, id, true, until, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
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

  /**
   * Сброс 2FA человеку, потерявшему аутентификатор (и backup-коды). Только строго старший
   * по роли в своём охвате и только с кодом СВОЕГО второго фактора — в любом клиенте, а не
   * лишь в мини-аппе, как у @RequiresConfirmation: сброс снимает с чужой учётки защиту.
   * В мини-апп маршрут не открыт.
   */
  @Post(':id/2fa/reset')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @ApiOperation({
    summary:
      'Сбросить 2FA пользователя (роль строго ниже, свой scope; код своей 2FA): выключает 2FA, гасит сессии, письмо владельцу',
  })
  @ApiResponse({ status: 201, description: 'Сброшено' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — у пользователя 2FA не включена / свою' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE — неверный код администратора' })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — роль не ниже вашей или у вас нет 2FA; WRONG_SCOPE — другой вуз',
  })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — слишком много неверных кодов' })
  async resetTwoFactor(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ResetTwoFactorDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.users.resetTwoFactor(
      user,
      id,
      () => this.confirmation.verifyForUser(user.sub, dto.code),
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
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
  async unblock(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.users.setBlocked(user, id, false, null, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    return null
  }
}
