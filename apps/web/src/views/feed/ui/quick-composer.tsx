'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { ImageIcon, Video } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'

/**
 * Панель над лентой: «Поделитесь чем-нибудь…» и быстрые «Фото» и «Видео». Своего редактора
 * у неё нет — любое нажатие открывает общий редактор публикации (`onCompose`), кнопки
 * медиа — сразу с выбранными файлами. Выбор файлов идёт синхронно из нажатия (иначе
 * браузер не откроет диалог), поэтому поля выбора лежат здесь.
 */
export function QuickComposer({ onCompose }: { onCompose: (files?: readonly File[]) => void }) {
  const t = useTranslations('Feed')
  const me = useAppSelector((s) => s.auth.user)
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  const pick = (input: HTMLInputElement): void => {
    const files = input.files ? Array.from(input.files) : []
    input.value = ''
    if (files.length > 0) onCompose(files)
  }

  return (
    <div className="flex items-center gap-2 bg-card px-4 py-3 max-sm:-mx-4 max-sm:border-y max-sm:border-border sm:rounded-xl sm:ring-1 sm:ring-foreground/10">
      <Avatar className="size-10 shrink-0">
        {me?.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
        <AvatarFallback>
          {(me?.lastName.charAt(0) ?? '') + (me?.firstName.charAt(0) ?? '')}
        </AvatarFallback>
      </Avatar>
      {/* Похоже на поле, но это кнопка: писать удобнее в полном редакторе с аудиторией и
          вложениями, а не в однострочном поле над лентой. */}
      <button
        type="button"
        onClick={() => onCompose()}
        className="flex h-10 min-w-0 flex-1 cursor-text items-center rounded-full bg-muted/60 px-4 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="truncate">{t('composerPlaceholder')}</span>
      </button>
      <ComposerAction
        label={t('addPhoto')}
        onClick={() => photoRef.current?.click()}
        icon={<ImageIcon className="size-5 text-success" aria-hidden />}
      />
      <ComposerAction
        label={t('addVideo')}
        onClick={() => videoRef.current?.click()}
        icon={<Video className="size-5 text-info" aria-hidden />}
      />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => pick(e.currentTarget)}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => pick(e.currentTarget)}
      />
    </div>
  )
}

function ComposerAction({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:size-auto sm:h-10 sm:px-3"
    >
      {icon}
      <span className="max-sm:hidden">{label}</span>
    </button>
  )
}
