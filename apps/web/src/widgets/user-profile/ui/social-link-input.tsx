'use client'

import { cn } from '../../../shared/lib/utils'

/** Соцсеть поля: от неё — префикс маски, допустимые символы и вид сохраняемого значения. */
export type SocialPlatform = 'telegram' | 'instagram' | 'linkedin'

interface PlatformMask {
  /** Что стоит перед логином в поле — неизменяемая часть маски. */
  prefix: string
  /** Логин из сохранённого значения (ссылки или @имени). */
  parse: (value: string) => string
  /** Сохраняемое значение из логина. */
  build: (handle: string) => string
  /** Символы, которые можно набрать в логине. */
  allowed: RegExp
}

const MASKS: Record<SocialPlatform, (linkedinKind: string) => PlatformMask> = {
  // Telegram хранится «@имя» — так его и пишут на визитках; ссылка t.me тоже принимается.
  telegram: () => ({
    prefix: '@',
    parse: (v) => v.replace(/^@+/, '').replace(/^https?:\/\/t\.me\//i, ''),
    build: (h) => `@${h}`,
    allowed: /[^A-Za-z0-9_]/g,
  }),
  instagram: () => ({
    prefix: 'instagram.com/',
    parse: (v) => v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, ''),
    build: (h) => `https://instagram.com/${h}`,
    allowed: /[^A-Za-z0-9._]/g,
  }),
  // У компании — страница company, у вуза — school (так их адресует сам LinkedIn).
  linkedin: (kind) => ({
    prefix: `linkedin.com/${kind}/`,
    parse: (v) =>
      v
        .replace(/^https?:\/\/(www\.)?linkedin\.com\/(company|school|in)\//i, '')
        .replace(/\/+$/, ''),
    build: (h) => `https://linkedin.com/${kind}/${h}`,
    allowed: /[^A-Za-z0-9\-_.%]/g,
  }),
}

/**
 * Поле соцсети с маской: префикс адреса закреплён, вводится только логин. Ссылку целиком
 * собирает поле — вставленный адрес тоже разбирается до логина. Пустой логин — пустая
 * строка («очистить поле»).
 */
export function SocialLinkInput({
  id,
  value,
  onChange,
  onBlur,
  platform,
  linkedinKind = 'company',
  invalid,
}: {
  id?: string
  value: string | null | undefined
  onChange: (value: string) => void
  onBlur?: () => void
  platform: SocialPlatform
  linkedinKind?: 'company' | 'school'
  invalid?: boolean
}) {
  const mask = MASKS[platform](linkedinKind)
  const handle = mask.parse(value ?? '')
  return (
    <div
      className={cn(
        'flex h-10 min-w-0 items-center rounded-xl border border-input bg-background transition-[color,box-shadow,border-color] hover:border-ring/50 focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 dark:bg-input/30',
        invalid && 'border-destructive ring-4 ring-destructive/15',
      )}
    >
      <span className="shrink-0 pl-3.5 text-base text-muted-foreground select-none md:text-sm">
        {mask.prefix}
      </span>
      <input
        id={id}
        value={handle}
        aria-invalid={invalid}
        onBlur={onBlur}
        onChange={(e) => {
          const next = mask.parse(e.target.value.trim()).replace(mask.allowed, '')
          onChange(next ? mask.build(next) : '')
        }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent pr-3.5 text-base outline-none placeholder:text-muted-foreground/70 md:text-sm"
      />
    </div>
  )
}
