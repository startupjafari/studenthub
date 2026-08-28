import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { OpsButton, OpsMessage } from './ops-message.builder'
import { sanitizeOpsText } from './ops-sanitizer'

// Единственная точка сетевого вызова в api.telegram.org (docs/TELEGRAM_BOT.md §4.3, §7.1.1).
// `fetch` на Telegram из любого другого файла — блокирующее замечание на ревью.
//
// Контракт, от которого зависят все вызывающие:
//   • метод НИКОГДА не бросает — ни при сетевой ошибке, ни при 4xx, ни без токена (§0.1.3);
//   • жёсткий таймаут и одна повторная попытка;
//   • текст проходит через санитайзер ПЕРЕД отправкой, что бы в него ни положили (§7.2.2).
//
// Ошибка отправки не порождает ops-событие (§7.2.6): иначе получим петлю «не смогли
// отправить алерт → отправляем алерт об этом». Только лог.

const API_BASE = 'https://api.telegram.org'
const TIMEOUT_MS = 5000
const RETRY_DELAY_MS = 500

/** Ответ Bot API в той части, которая нам нужна, плюс HTTP-код: по нему различаются
 *  «сообщения больше нет» и «сеть моргнула». */
interface TelegramResponse {
  ok: boolean
  status?: number
  description?: string
  result?: { message_id?: number }
}

/** Исход правки: `gone` — сообщения больше нет, нужно новое; `failed` — повторим позже. */
export type EditOutcome = 'ok' | 'gone' | 'failed'

@Injectable()
export class TelegramOpsService {
  private readonly logger = new Logger(TelegramOpsService.name)
  private readonly token?: string
  private readonly chatId?: string

  constructor(config: ConfigService<EnvVars, true>) {
    this.token = config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    this.chatId = config.get('TELEGRAM_OPS_CHAT_ID', { infer: true })
  }

  /**
   * Готов ли транспорт. Без токена или chat_id все операции — no-op: модуль поднимается
   * только с токеном, но chat_id могли забыть, и это не повод падать.
   */
  get enabled(): boolean {
    return Boolean(this.token && this.chatId)
  }

  /** Отправляет сообщение. Возвращает `message_id` (нужен для правок, §3.2) или `null`. */
  async send(message: OpsMessage): Promise<number | null> {
    const res = await this.call('sendMessage', {
      chat_id: this.chatId,
      message_thread_id: message.threadId,
      text: sanitizeOpsText(message.text),
      disable_notification: message.silent,
      link_preview_options: { is_disabled: true },
      reply_markup: this.keyboard(message.buttons),
    })
    return res?.result?.message_id ?? null
  }

  /**
   * Переписывает уже отправленное сообщение (§3.2, §3.3).
   *
   * Три исхода вместо булева не прихоть: `gone` (сообщение удалили руками, истекло право
   * на правку) требует отправить новое, а `failed` (сеть, 5xx) — наоборот, ничего не
   * делать и дождаться следующей попытки. Свести их в `false` значило бы либо плодить
   * дубликаты закреплённого статуса при каждом сбое сети, либо навсегда замолчать после
   * одного удалённого сообщения.
   *
   * `message is not modified` тоже приходит как `gone` по коду, но до этого не доходит:
   * вызывающий не редактирует неизменившееся (§3.3).
   */
  async edit(messageId: number, message: OpsMessage): Promise<EditOutcome> {
    const res = await this.call('editMessageText', {
      chat_id: this.chatId,
      message_id: messageId,
      text: sanitizeOpsText(message.text),
      link_preview_options: { is_disabled: true },
      reply_markup: this.keyboard(message.buttons),
    })
    if (res?.ok) return 'ok'
    // «Не изменилось» Telegram отдаёт как 400, но это успех: содержимое уже такое, какое
    // нужно. Без этой ветки повторный вебхук с тем же текстом считался бы за `gone`
    // и порождал бы второе сообщение о том же деплое.
    if (res?.description?.includes('message is not modified')) return 'ok'
    return res?.status && res.status >= 400 && res.status < 500 ? 'gone' : 'failed'
  }

  /** Закрепляет сообщение (живой статус, §3.3) — молча, без уведомления участникам. */
  async pin(messageId: number): Promise<boolean> {
    const res = await this.call('pinChatMessage', {
      chat_id: this.chatId,
      message_id: messageId,
      disable_notification: true,
    })
    return res?.ok === true
  }

  /** Инлайн-клавиатура из кнопок-ссылок. Пустой список — поля вовсе нет. */
  private keyboard(buttons: OpsButton[]): { inline_keyboard: OpsButton[][] } | undefined {
    return buttons.length ? { inline_keyboard: [buttons] } : undefined
  }

  /**
   * Вызов Bot API: таймаут, одна повторная попытка, никаких исключений наружу.
   *
   * Повтор делаем только на сетевой сбой и 5xx: на 4xx (битый chat_id, удалённая тема,
   * слишком длинный текст) повтор даст ту же ошибку и лишнюю задержку в воркере.
   */
  private async call(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<null | TelegramResponse> {
    if (!this.enabled) return null

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
      try {
        const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // undefined-поля JSON.stringify выкидывает сам — Telegram получает только заданные.
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const body = { ...((await res.json()) as TelegramResponse), status: res.status }
        if (body.ok) return body

        // Описание ошибки Telegram может содержать кусок отправленного текста — санитайзим.
        this.logger.warn(
          `Telegram ${method} отказал (${res.status}): ${sanitizeOpsText(body.description ?? '')}`,
        )
        if (res.status < 500) return body
      } catch (error) {
        this.logger.warn(
          `Telegram ${method} не отправлен (попытка ${attempt + 1}): ${String(error)}`,
        )
      }
    }
    return null
  }
}
