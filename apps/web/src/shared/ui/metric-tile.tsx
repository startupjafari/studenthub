'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from './card'
import { Progress } from './progress'
import { Skeleton } from './skeleton'
import { useCountUp } from '../lib/use-count-up'
import { cn } from '../lib/utils'

/**
 * Плитка показателя: иконка в чипе слева, число и подпись справа.
 *
 * Одна шкала для всех сводок платформы — дашборд вуза, аналитика факультета, обзор
 * документов. Раньше каждый экран собирал её заново: где-то иконка стояла над числом
 * и плитка вырастала вдвое, где-то отличался кегль. Поднята в систему по
 * DESIGN_SYSTEM §17 («нужен такой элемент на новом экране — не копировать»).
 *
 * `tone` красит только чип иконки: число остаётся текстовым токеном, иначе значение
 * начинало бы нести цвет данных. Исключение — `valueTone` для показателя, который
 * сам по себе тревожный (посещаемость ниже порога).
 *
 * `href` делает плитку ссылкой: на операционных экранах («Сегодня» декана) счётчик без
 * перехода к самим данным — тупик. Такая плитка обязана выглядеть нажимаемой: шеврон
 * справа, наведение и кольцо фокуса по §8. Плитка без `href` их не получает — обещать
 * переход, которого нет, хуже, чем выглядеть скромно.
 *
 * `progress` добавляет полоску под числом — там, где показатель это доля (успеваемость,
 * посещаемость, набранные кредиты): «68%» и «68% из 100 при пороге 75» читаются по-разному.
 */
export function MetricTile({
  icon: Icon,
  tone = 'text-primary',
  label,
  value,
  valueTone,
  hint,
  delta,
  loading,
  href,
  progress,
  progressTone,
  index = 0,
}: {
  icon: LucideIcon
  /** Тон чипа иконки — текстовый класс; фон берётся как `bg-current/10`. */
  tone?: string
  label: string
  value: number | string | null
  /** Тон самого числа. По умолчанию — обычный текст. */
  valueTone?: string
  /** Пояснение под подписью: к чему относится число (период, порог). */
  hint?: string
  /** Изменение к прошлому периоду. `good` решает вызывающий экран: рост жалоб — плохо. */
  delta?: { text: string; good: boolean } | null
  loading?: boolean
  /** Задан — плитка становится ссылкой на раздел с этими данными. */
  href?: string
  /** Доля 0–100 под числом. `null` — данных ещё нет, полоски не будет. */
  progress?: number | null
  /** Класс заливки полоски: порог «хорошо/плохо» знает вызывающий экран. */
  progressTone?: string
  /** Порядковый номер в ряду — задаёт задержку входа, плитки появляются волной. */
  index?: number
}) {
  // Счёт от нуля — только для чисел: «85%» или «12 из 30» посчитать нечем, да и
  // строковое значение обычно составное, а не одна величина.
  const numeric = typeof value === 'number' ? value : null
  const counted = useCountUp(numeric ?? 0, !Number.isInteger(numeric ?? 0))
  const shown = loading ? null : numeric !== null ? counted : (value ?? '—')

  const tile = (
    <Card
      size="sm"
      style={{ animationDelay: `${index * 60}ms` }}
      className={cn(
        'h-full gap-2',
        'animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none',
        href
          ? // Кликабельная карточка (§8): подложка на наведении. Кольцо фокуса рисует
            // ссылка-обёртка — оно должно быть снаружи, а у карточки overflow-hidden.
            'transition-colors group-hover/tile:bg-muted/40'
          : // Некликабельная плитка: только намёк на кольце, без подъёма — он обещал бы переход.
            'transition-[box-shadow] hover:ring-ring/50',
      )}
    >
      <CardContent className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10 transition-colors',
            href && 'group-hover/tile:bg-current/20',
            tone,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span
              className={cn('block text-xl leading-tight font-semibold tabular-nums', valueTone)}
            >
              {loading ? <Skeleton className="h-5 w-10" /> : shown}
            </span>
            {delta && !loading && (
              <span
                className={cn(
                  'shrink-0 text-xs font-medium tabular-nums',
                  delta.good ? 'text-success' : 'text-destructive',
                )}
              >
                {delta.text}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{label}</span>
          {hint && (
            <span className="block truncate text-[0.6875rem] text-muted-foreground/80">{hint}</span>
          )}
        </span>
        {href && (
          // Шеврон — единственный статичный признак «сюда можно перейти»: наведения на
          // тач-экране нет, а плитка-счётчик и плитка-ссылка иначе неразличимы.
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/tile:translate-x-0.5"
            aria-hidden
          />
        )}
      </CardContent>
      {typeof progress === 'number' && !loading && (
        <div className="px-3">
          <Progress
            value={progress}
            aria-label={`${label}: ${String(value ?? '')}`}
            className="h-1.5"
            indicatorClassName={progressTone}
          />
        </div>
      )}
    </Card>
  )
  return href ? (
    <Link
      href={href}
      className="group/tile block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {tile}
    </Link>
  ) : (
    tile
  )
}
