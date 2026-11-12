import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatChecklistsService } from './chat-checklists.service'
import { ChatChecklistItemAddDto, ChatChecklistItemToggleDto } from './dto/chat-checklist-item.dto'

// Чек-листы в чатах: пункты после отправки. Сам список отправляется `POST /chats/:id/checklist`.
// Каждое изменение рассылается комнате чата `checklist:updated` (docs/PROJECT.md §9.2).
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/checklists')
export class ChatChecklistsController {
  constructor(private readonly checklists: ChatChecklistsService) {}

  @Get(':checklistId')
  @ApiOperation({ summary: 'Чек-лист целиком (участник чата)' })
  @ApiResponse({ status: 200, description: 'Чек-лист с пунктами' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — списка нет или сообщение удалено' })
  get(@CurrentUser() user: CurrentUserData, @Param('checklistId') checklistId: string) {
    return this.checklists.get(user.sub, checklistId)
  }

  @Post(':checklistId/items')
  @ApiOperation({ summary: 'Добавить пункт (автор списка или все при othersCanAdd)' })
  @ApiResponse({ status: 201, description: 'Чек-лист после изменения' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — добавлять может только автор' })
  addItem(
    @CurrentUser() user: CurrentUserData,
    @Param('checklistId') checklistId: string,
    @Body() dto: ChatChecklistItemAddDto,
  ) {
    return this.checklists.addItem(user.sub, checklistId, dto.text)
  }

  @Delete(':checklistId/items/:itemId')
  @ApiOperation({ summary: 'Убрать пункт (автор списка или тот, кто добавил пункт)' })
  @ApiResponse({ status: 200, description: 'Чек-лист после изменения' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не автор списка и не автор пункта' })
  removeItem(
    @CurrentUser() user: CurrentUserData,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.checklists.removeItem(user.sub, checklistId, itemId)
  }

  @Post(':checklistId/items/:itemId/toggle')
  @ApiOperation({ summary: 'Отметить пункт выполненным или снять отметку' })
  @ApiResponse({ status: 201, description: 'Чек-лист после изменения' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — отмечать может только автор' })
  toggleItem(
    @CurrentUser() user: CurrentUserData,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ChatChecklistItemToggleDto,
  ) {
    return this.checklists.toggleItem(user.sub, checklistId, itemId, dto.done)
  }
}
