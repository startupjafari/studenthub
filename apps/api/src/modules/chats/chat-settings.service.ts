import { Injectable } from '@nestjs/common'
import { DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'
import type { ChatSettingsResponse, ChatSettingsUpdateInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { RealtimeGateway } from '../../common/realtime'

// Личные настройки чатов (§9). Пока одна — своя быстрая реакция: её ставит двойной клик или
// двойное касание по сообщению на всех клиентах. Хранится полем User.chatDefaultReaction,
// NULL — общая по умолчанию; наружу всегда уходит уже подставленное значение, чтобы клиентам
// не держать свою копию дефолта.
//
// Своим устройствам смена уходит сигналом `chat:settings-changed` с новым значением: реакция
// по двойному клику на соседней вкладке не должна оставаться старой до перезагрузки.
@Injectable()
export class ChatSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async get(userId: string): Promise<ChatSettingsResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { chatDefaultReaction: true },
    })
    if (!user) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    return toResponse(user.chatDefaultReaction)
  }

  async update(userId: string, dto: ChatSettingsUpdateInput): Promise<ChatSettingsResponse> {
    // Выбор общей по умолчанию хранится как NULL, а не копией: тогда смена дефолта платформы
    // дойдёт и до тех, кто однажды «выбрал» его явно.
    const stored = dto.defaultReaction === DEFAULT_CHAT_REACTION ? null : dto.defaultReaction
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { chatDefaultReaction: stored },
      select: { chatDefaultReaction: true },
    })
    const res = toResponse(user.chatDefaultReaction)
    this.realtime.emitToUser(userId, 'chat:settings-changed', res)
    return res
  }
}

function toResponse(defaultReaction: string | null): ChatSettingsResponse {
  return { defaultReaction: defaultReaction ?? DEFAULT_CHAT_REACTION }
}
