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
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatGroupsService } from './chat-groups.service'
import { ChatsService } from './chats.service'
import { ChatJoinSettingsDto, UpdateChatPermissionsDto } from './dto/chat-groups.dto'

// Управление группой как в Telegram (docs/PROJECT.md §8.3): «Разрешения», тип группы, заявки
// на вступление, исключённые, история фото. Отдельный контроллер — ChatsController и так
// самый длинный в API; пути `chats/:id/...` с ним не пересекаются.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats')
export class ChatGroupsController {
  constructor(
    private readonly groups: ChatGroupsService,
    private readonly chats: ChatsService,
  ) {}

  @Patch(':id/permissions')
  @ApiOperation({ summary: 'Разрешения участников группы (только админ группы)' })
  @ApiResponse({ status: 200, description: '{ chatId, permissions, joinByLink, joinApproval }' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не админ группы' })
  updatePermissions(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateChatPermissionsDto,
  ) {
    return this.groups.updatePermissions(user, id, dto)
  }

  @Patch(':id/join-settings')
  @ApiOperation({
    summary: 'Тип группы: вступление по ссылке и одобрение заявок (только админ группы)',
  })
  @ApiResponse({ status: 200, description: '{ chatId, permissions, joinByLink, joinApproval }' })
  updateJoinSettings(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatJoinSettingsDto,
  ) {
    return this.groups.updateJoinSettings(user, id, dto)
  }

  @Get(':id/join-requests')
  @ApiOperation({ summary: 'Заявки на вступление в группу (только админ группы)' })
  @ApiResponse({ status: 200, description: 'Люди с временем заявки, свежие первыми' })
  joinRequests(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.groups.listJoinRequests(user, id)
  }

  @Post(':id/join-requests/:userId/approve')
  @ApiOperation({ summary: 'Одобрить заявку на вступление (только админ группы)' })
  @ApiResponse({ status: 201, description: 'Человек стал участником' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — заявки нет' })
  approve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.groups.approveJoinRequest(user, id, userId)
  }

  @Delete(':id/join-requests/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отклонить заявку на вступление (только админ группы)' })
  @ApiResponse({ status: 204, description: 'Заявка отклонена' })
  async decline(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.groups.declineJoinRequest(user, id, userId)
  }

  @Get(':id/removed')
  @ApiOperation({ summary: 'Исключённые участники группы (только админ группы)' })
  @ApiResponse({ status: 200, description: 'Люди с временем исключения и кто исключил' })
  removed(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.groups.listRemoved(user, id)
  }

  @Get(':id/avatars')
  @ApiOperation({ summary: 'История фото группы (участнику), текущее — первым' })
  @ApiResponse({ status: 200, description: '[{ id, url, createdAt, current }]' })
  avatars(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.listChatPhotos(user.sub, id)
  }

  @Delete(':id/avatars/:photoId')
  @ApiOperation({
    summary: 'Удалить фото группы из истории (только создатель); текущее сменится предыдущим',
  })
  @ApiResponse({ status: 200, description: '{ id, avatarUrl } — текущее фото группы после' })
  deleteAvatar(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.chats.deleteChatPhoto(user, id, photoId)
  }
}
