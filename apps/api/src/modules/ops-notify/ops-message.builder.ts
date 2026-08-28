import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { OpsEventSpec, OpsStatus, OpsTopic } from '../../common/monitoring/ops-event.registry'
import type { OpsEventData } from '../../common/monitoring/ops-notifier.interface'
import type { DigestSnapshot, OpsStatusSnapshot, QueueStatus } from './ops-status.service'
import type { EnvVars } from '../../config/env.schema'

// Единственный сборщик текста служебных сообщений (docs/TELEGRAM_BOT.md §4.4, §7.1.2).
// Ручная склейка строк в местах вызова запрещена: разъедется формат, а канал читают
// глазами — два вида одного события выглядят как два разных инцидента.

/** Кнопка-ссылка под сообщением (§3.4). Только URL, никаких callback'ов. */
export interface OpsButton {
  text: string
  url: string
}

/** Готовое к отправке сообщение. Всё, что нужно транспорту, и ничего сверх. */
export interface OpsMessage {
  text: string
  /** `message_thread_id` темы. Не задан — общий поток группы (допустимая деградация, §1). */
  threadId?: number
  buttons: OpsButton[]
  silent: boolean
  /**
   * Ключ переписываемого сообщения (§3.2). Задан — воркер сначала попробует переписать
   * ранее отправленное с тем же ключом. Не найдено (рестарт, истёк TTL) — отправит новое,
   * а не потеряет событие.
   */
  editKey?: string
}

const STATUS_EMOJI: Record<OpsStatus, string> = {
  ok: '🟢',
  error: '🔴',
  warn: '🟡',
  info: '⚪️',
}

/** `{поле}` в заголовке заменяется значением из данных; неизвестное поле остаётся как есть. */
const PLACEHOLDER = /\{(\w+)\}/g

@Injectable()
export class OpsMessageBuilder {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  /**
   * Имя события в текст не идёт: для читателя канала это внутренняя деталь. Оно остаётся
   * в логах и в ключе дедупликации, поэтому здесь принимается только спека и данные.
   */
  build(spec: OpsEventSpec, data: OpsEventData = {}): OpsMessage {
    const title = spec.title.replace(PLACEHOLDER, (whole, field: string) =>
      data[field] === undefined ? whole : String(data[field]),
    )

    // Первая строка — эмодзи, метка окружения и суть: в списке чатов видно только её.
    const head = `${STATUS_EMOJI[spec.status]} ${this.envPrefix()}${title}`

    // Вторая строка — поля через `·`. Отсутствующие поля пропускаем молча: событие с
    // неполными данными лучше отправить коротким, чем не отправить.
    const details = (spec.fields ?? [])
      .filter((f) => data[f.field] !== undefined && data[f.field] !== '')
      .map((f) => (f.label ? `${f.label}: ${data[f.field]}` : String(data[f.field])))
      .join(' · ')

    const editKey = spec.editKey ? data[spec.editKey] : undefined

    return {
      text: details ? `${head}\n${details}` : head,
      threadId: this.threadId(spec.topic),
      buttons: this.buttons(spec, data),
      silent: spec.silent === true,
      ...(editKey === undefined ? {} : { editKey: `${spec.editKey}:${editKey}` }),
    }
  }

  /**
   * Живой закреплённый статус (§3.3): открыл канал, посмотрел вверх — видно всё.
   *
   * Собирается здесь же, а не рядом с проверкой: сборщик текста в модуле один (§7.1.2).
   * Это не событие реестра, а одно постоянно переписываемое сообщение, поэтому у него
   * свой формат — но та же метка окружения и та же эмодзи-азбука статусов.
   */
  buildStatus(snapshot: OpsStatusSnapshot): OpsMessage {
    const broken = snapshot.dependencies.filter((d) => !d.up)
    const head = `${broken.length ? STATUS_EMOJI.error : STATUS_EMOJI.ok} ${this.envPrefix()}StudentHub — статус`

    const lines = [
      head,
      `версия: ${snapshot.release} · аптайм: ${formatUptime(snapshot.uptimeMs)}`,
      snapshot.dependencies
        .map((d) => `${d.name} ${d.up ? STATUS_EMOJI.ok : STATUS_EMOJI.error}`)
        .join(' · '),
      // Пустые очереди не печатаем: строка из одних нулей занимает экран и ничего не говорит.
      `очереди: ${
        snapshot.queues
          .filter((q) => q.waiting || q.active || q.failed)
          .map((q) => `${q.name} ${q.waiting}/${q.active}${q.failed ? ` ✗${q.failed}` : ''}`)
          .join(' · ') || 'пусто'
      }`,
      `обновлено: ${formatMoment(snapshot.checkedAt)}`,
    ]

    return {
      text: lines.join('\n'),
      threadId: this.threadId('digest'),
      buttons: [],
      // Правки закреплённого не должны будить никого (§3.3).
      silent: true,
    }
  }

  /**
   * Вечерняя сводка (§2.3). Это НЕ алерт: здесь смотрят на тренд, а не бегут чинить,
   * поэтому одно сообщение со всеми строками, а не строка на каждую находку (§7.4.7).
   *
   * Пустые разделы опускаются: сводка, где половина строк — нули, перестаёт читаться.
   */
  buildDigest(digest: DigestSnapshot): OpsMessage {
    const { database, storage, push, backlog, activity, orphansRemoved } = digest

    const lines = [`${STATUS_EMOJI.info} ${this.envPrefix()}Сводка за сутки`]

    const delta =
      database.weekDeltaBytes === null ? '' : ` (${withSign(database.weekDeltaBytes)} за неделю)`
    lines.push(`БД: ${formatBytes(database.totalBytes)}${delta}`)
    if (database.topTables.length) {
      lines.push(
        `  топ: ${database.topTables.map((t) => `${t.table} ${formatBytes(t.bytes)}`).join(' · ')}`,
      )
    }

    if (storage.length) {
      const totalBytes = storage.reduce((sum, b) => sum + b.bytes, 0)
      lines.push(`Хранилище: ${formatBytes(totalBytes)} в ${storage.length} бакетах`)
      lines.push(
        `  ${storage
          .slice(0, TOP_BUCKETS)
          .map((b) => `${b.bucket} ${formatBytes(b.bytes)}`)
          .join(' · ')}`,
      )
    }
    if (orphansRemoved !== null) {
      lines.push(`  сирот убрано ночью: ${orphansRemoved}`)
    }

    if (push.sent || push.gone) {
      lines.push(
        `Push: ${push.sent} доставлено, ${push.gone} мёртвых подписок (${push.goneShare}%)`,
      )
    }

    const waiting = backlog.complaints + backlog.applications + backlog.invites
    lines.push(
      waiting
        ? `Ждут человека: жалобы ${backlog.complaints} · заявки ${backlog.applications} · инвайты ${backlog.invites}`
        : 'Ждут человека: ничего',
    )

    lines.push(
      `Активность: ${activity.active} за сутки, ${activity.registered} новых, 5xx ${activity.errorShare}%`,
    )

    return {
      text: lines.join('\n'),
      threadId: this.threadId('digest'),
      buttons: [],
      // Сводка приходит вечером и никого будить не должна: это тренд, а не инцидент.
      silent: true,
    }
  }

  /**
   * Ответ на `/queues` (§6). Показываем ВСЕ очереди, включая пустые: команду задают,
   * чтобы убедиться, что нигде не копится, и пропущенная строка читается как «не знаю».
   */
  buildQueues(queues: QueueStatus[]): OpsMessage {
    const broken = queues.some((q) => q.failed > 0)
    const lines = [
      `${broken ? STATUS_EMOJI.warn : STATUS_EMOJI.ok} ${this.envPrefix()}Очереди`,
      ...queues.map(
        (q) =>
          `${q.name}: ждут ${q.waiting} · в работе ${q.active}` +
          `${q.delayed ? ` · отложено ${q.delayed}` : ''}` +
          `${q.failed ? ` · упало ${q.failed}` : ''}`,
      ),
    ]
    return this.reply(lines)
  }

  /**
   * Ответ на `/migrations` (§6). Команда отвечает на «почему прод ведёт себя странно»,
   * поэтому показывает не только расхождение, но и его отсутствие — «всё применено»
   * это полноценный ответ.
   */
  buildMigrations(applied: number, pending: string[]): OpsMessage {
    const lines = pending.length
      ? [
          `${STATUS_EMOJI.error} ${this.envPrefix()}Неприменённые миграции: ${pending.length}`,
          ...pending.slice(0, MIGRATIONS_SHOWN),
          ...(pending.length > MIGRATIONS_SHOWN
            ? [`и ещё ${pending.length - MIGRATIONS_SHOWN}`]
            : []),
          `применено: ${applied}`,
        ]
      : [`${STATUS_EMOJI.ok} ${this.envPrefix()}Миграции применены: ${applied}`]
    return this.reply(lines)
  }

  /** Короткий ответ команды — подтверждение или подсказка. */
  buildReply(status: OpsStatus, text: string): OpsMessage {
    return this.reply([`${STATUS_EMOJI[status]} ${this.envPrefix()}${text}`])
  }

  /**
   * Ответ на команду уходит в ту тему, где команду написали, — её подставляет вызывающий.
   * Без звука: человек только что смотрел в чат, будить его собственным ответом незачем.
   */
  private reply(lines: string[]): OpsMessage {
    return { text: lines.join('\n'), buttons: [], silent: true }
  }

  /** Метка окружения (§3.6). `prod` не печатается — иначе шум в каждой строке. */
  private envPrefix(): string {
    const label = this.config.get('OPS_ENV_LABEL', { infer: true })
    return !label || label === 'prod' ? '' : `[${label}] `
  }

  private threadId(topic: OpsTopic): number | undefined {
    switch (topic) {
      case 'deploy':
        return this.config.get('TELEGRAM_TOPIC_DEPLOY', { infer: true })
      case 'alerts':
        return this.config.get('TELEGRAM_TOPIC_ALERTS', { infer: true })
      case 'digest':
        return this.config.get('TELEGRAM_TOPIC_DIGEST', { infer: true })
    }
  }

  /**
   * Кнопки собираются только из значений, которые действительно являются http(s)-ссылкой.
   * Битая ссылка — это 400 от Telegram и потерянное сообщение целиком, поэтому проверяем
   * здесь, а не надеемся на вызывающего.
   */
  private buttons(spec: OpsEventSpec, data: OpsEventData): OpsButton[] {
    const out: OpsButton[] = []
    for (const link of spec.links ?? []) {
      const raw = data[link.field]
      if (typeof raw !== 'string') continue
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        continue
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      out.push({ text: link.label, url: raw })
    }
    return out
  }
}

/** Сколько имён миграций показываем в ответе команды: остальное — счётчиком. */
const MIGRATIONS_SHOWN = 10

/** Сколько бакетов показываем в сводке: остальные — в общей сумме. */
const TOP_BUCKETS = 3

/** Байты в человеческих единицах: «1.4 ГБ» читается, «1503238553» — нет. */
function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${bytes < 0 ? '-' : ''}${rounded} ${units[unit] ?? 'Б'}`
}

/** Дельта всегда со знаком: «+120 МБ» и «-3 МБ» читаются по-разному, «120 МБ» — никак. */
function withSign(bytes: number): string {
  return `${bytes >= 0 ? '+' : ''}${formatBytes(bytes)}`
}

/** Аптайм крупными единицами: точность до секунды тут никому не нужна. */
function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  if (days) return `${days} д ${hours} ч`
  if (hours) return `${hours} ч ${minutes % 60} мин`
  return `${minutes} мин`
}

/**
 * Момент в UTC и явной пометкой: канал читают из разных часовых поясов, а «21:05» без
 * указания зоны — источник получаса споров при разборе инцидента.
 */
function formatMoment(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)} UTC`
}
