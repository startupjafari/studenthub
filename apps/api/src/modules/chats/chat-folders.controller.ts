import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatFoldersService } from './chat-folders.service'
import { CreateChatFolderDto, UpdateChatFolderDto } from './dto/chat-folder.dto'

// Пользовательские папки чатов (§2). Отдельный контроллер, а не методы в ChatsController:
// путь `chats/folders` не должен конкурировать с `chats/:id`, и регистрируется он в модуле
// раньше ChatsController.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/folders')
export class ChatFoldersController {
  constructor(private readonly folders: ChatFoldersService) {}

  @Get()
  @ApiOperation({ summary: 'Мои папки чатов (§2): имя, позиция вкладки, состав' })
  @ApiResponse({ status: 200, description: 'Список папок' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.folders.list(user.sub)
  }

  @Post()
  @ApiOperation({ summary: 'Создать папку (имя + необязательный стартовый состав)' })
  @ApiResponse({ status: 201, description: 'Папка создана' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — чат недоступен пользователю' })
  @ApiResponse({ status: 409, description: 'CONFLICT — имя занято или превышен лимит папок' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateChatFolderDto) {
    return this.folders.create(user.sub, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Переименовать папку, заменить состав или переставить вкладку' })
  @ApiResponse({ status: 200, description: 'Папка обновлена' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — папки нет у этого пользователя' })
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
}
