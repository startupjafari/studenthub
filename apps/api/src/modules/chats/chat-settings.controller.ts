import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatSettingsService } from './chat-settings.service'
import { ChatSettingsUpdateDto } from './dto/chat-settings.dto'

// Личные настройки чатов (§9). Отдельный контроллер со статическим префиксом — как папки:
// путь `chats/settings` не должен читаться как `chats/:id`.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/settings')
export class ChatSettingsController {
  constructor(private readonly settings: ChatSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Мои настройки чатов: быстрая реакция по двойному клику' })
  @ApiResponse({ status: 200, description: '{ defaultReaction } — уже с подставленным дефолтом' })
  get(@CurrentUser() user: CurrentUserData) {
    return this.settings.get(user.sub)
  }

  @Patch()
  @ApiOperation({
    summary: 'Сменить быструю реакцию (один эмодзи); null — вернуть общую по умолчанию',
  })
  @ApiResponse({ status: 200, description: '{ defaultReaction } — новое значение' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — не ровно один эмодзи' })
  update(@CurrentUser() user: CurrentUserData, @Body() dto: ChatSettingsUpdateDto) {
    return this.settings.update(user.sub, dto)
  }
}
