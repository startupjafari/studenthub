'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileUp, ImageIcon } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

/** Атрибут зоны: по нему обработчик `drop` переписки узнаёт, как отправить файлы. */
export const DROP_AS_ATTR = 'data-drop-as'

/** Как отправить брошенное: `file` — без сжатия, `media` — фото и видео превью. */
export function dropModeOf(target: EventTarget | null): 'file' | 'media' | null {
  if (!(target instanceof Element)) return null
  const zone = target.closest(`[${DROP_AS_ATTR}]`)
  const mode = zone?.getAttribute(DROP_AS_ATTR)
  return mode === 'file' || mode === 'media' ? mode : null
}

/** Все перетаскиваемые элементы — фото или видео (тип виден уже во время перетаскивания). */
function draggingOnlyMedia(dt: DataTransfer | null): boolean {
  const items = Array.from(dt?.items ?? []).filter((i) => i.kind === 'file')
  return items.length > 0 && items.every((i) => /^(image|video)\//.test(i.type))
}

/**
 * Зоны перетаскивания над перепиской, как в Telegram: «отправить без сжатия» и, если тащат
 * только снимки и видео, «отправить как фото». Обе зоны принимают файл и подсвечиваются
 * под курсором; сам `drop` ловит переписка и спрашивает зону через {@link dropModeOf} —
 * так счётчик вложенных dragenter/dragleave остаётся в одном месте.
 */
export function ComposerDropArea() {
  const t = useTranslations('Chats')
  const [onlyMedia, setOnlyMedia] = useState(false)
  const [hover, setHover] = useState<'file' | 'media' | null>(null)

  // Состав перетаскиваемого читаем с первого dragover над окном: к моменту, когда зона
  // появилась, dragenter уже прошёл, а список типов доступен в каждом событии перетаскивания.
  useEffect(() => {
    const onOver = (e: DragEvent): void => setOnlyMedia(draggingOnlyMedia(e.dataTransfer))
    window.addEventListener('dragover', onOver)
    return () => window.removeEventListener('dragover', onOver)
  }, [])

  const zones: { mode: 'file' | 'media'; title: string; hint: string; icon: typeof FileUp }[] = [
    {
      mode: 'file',
      title: t('tgComposer.dropAsFileTitle'),
      hint: t('tgComposer.dropAsFileHint'),
      icon: FileUp,
    },
    ...(onlyMedia
      ? [
          {
            mode: 'media' as const,
            title: t('tgComposer.dropAsMediaTitle'),
            hint: t('tgComposer.dropAsMediaHint'),
            icon: ImageIcon,
          },
        ]
      : []),
  ]

  return (
    <div className="absolute inset-0 z-40 flex flex-col gap-2 bg-background/70 p-3 backdrop-blur-sm duration-(--motion-menu) animate-in fade-in-0 lg:p-5">
      {zones.map((z) => (
        <div
          key={z.mode}
          {...{ [DROP_AS_ATTR]: z.mode }}
          onDragOver={() => setHover(z.mode)}
          onDragLeave={() => setHover((h) => (h === z.mode ? null : h))}
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-card p-4 text-center transition-[border-color,background-color]',
            hover === z.mode ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <z.icon
            className={cn(
              'pointer-events-none size-10 shrink-0',
              hover === z.mode ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <p className="pointer-events-none text-base font-semibold">{z.title}</p>
          <p className="pointer-events-none text-sm text-muted-foreground">{z.hint}</p>
        </div>
      ))}
    </div>
  )
}
