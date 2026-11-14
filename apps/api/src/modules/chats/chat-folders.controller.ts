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
  Put,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatFoldersService } from './chat-folders.service'
import {
  ChatFolderMuteDto,
  ChatFoldersOrderDto,
  CreateChatFolderDto,
  UpdateChatFolderDto,
} from './dto/chat-folder.dto'

// Пользовательские папки чатов (§2). Отдельный контроллер, а не методы в ChatsController:
// путь `chats/folders` не должен конкурировать с `chats/:id`, и регистрируется он в модуле
// раньше ChatsController.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/folders')
export class ChatFoldersController {
  constructor(private readonly folders: ChatFoldersService) {}

  @Get()
  @ApiOperation({
    summary: 'Мои папки чатов (§2): имя, позиция, значок, цвет, состав, исключения и правила',
  })
  @ApiResponse({ status: 200, description: 'Список папок' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.folders.list(user.sub)
  }

  @Post()
  @ApiOperation({
    summary: 'Создать папку (имя + необязательные состав, исключения, значок, цвет и правила)',
  })
  @ApiResponse({ status: 201, description: 'Папка создана' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — чат недоступен пользователю' })
  @ApiResponse({ status: 409, description: 'CONFLICT — имя занято или превышен лимит папок' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — чат и в составе, и в исключениях' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateChatFolderDto) {
    return this.folders.create(user.sub, dto)
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Порядок вкладок-папок: ровно все мои папки сверху вниз' })
  @ApiResponse({ status: 204, description: 'Порядок сохранён' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — не ровно множество моих папок' })
  async reorder(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChatFoldersOrderDto,
  ): Promise<void> {
    await this.folders.reorder(user.sub, dto.folderIds)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Переименовать папку, заменить состав/исключения/правила или переставить вкладку',
  })
  @ApiResponse({ status: 200, description: 'Папка обновлена' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — папки нет у этого пользователя' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — чат и в составе, и в исключениях' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateChatFolderDto,
  ) {
    return this.folders.update(user.sub, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить папку (сами чаты остаются)' })
  @ApiResponse({ status: 200, description: 'Папка удалена' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — папки нет у этого пользователя' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.folders.remove(user.sub, id)
  }

  @Post(':id/mute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Заглушить все чаты папки (minutes? — на время, иначе навсегда; importantOnly?)',
  })
  @ApiResponse({ status: 200, description: '{ updated } — сколько чатов заглушено' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — папки нет у этого пользователя' })
  mute(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatFolderMuteDto,
  ) {
    return this.folders.mute(user.sub, id, dto)
  }

  @Delete(':id/mute')
  @ApiOperation({ summary: 'Включить уведомления всех чатов папки' })
  @ApiResponse({ status: 200, description: '{ updated } — со скольких чатов снято заглушение' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — папки нет у этого пользователя' })
  unmute(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.folders.unmute(user.sub, id)
  }
}
