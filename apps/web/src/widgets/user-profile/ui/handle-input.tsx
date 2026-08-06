'use client'

// Ввод @username (Telegram/Instagram): пользователь вводит только логин, полная ссылка
// формируется автоматически. Хранится «голый» username без @.
const BASE: Record<string, string> = {
  telegram: 'https://t.me/',
  instagram: 'https://instagram.com/',
}

export function HandleInput({
  id,
  value,
  onChange,
  platform,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  platform: 'telegram' | 'instagram'
}) {
  const clean = (value ?? '').replace(/^@+/, '').trim()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-11 items-center rounded-xl border border-input bg-background transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 dark:bg-input/30">
        <span className="pl-3.5 text-muted-foreground select-none">@</span>
        <input
          id={id}
          value={clean}
          onChange={(e) => onChange(e.target.value.replace(/^@+/, '').trim())}
          placeholder="username"
          className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent pr-3.5 pl-1.5 text-base outline-none placeholder:text-muted-foreground/70 md:text-sm"
        />
      </div>
      {clean && (
        <span className="truncate text-xs text-muted-foreground">
          {BASE[platform]}
          {clean}
        </span>
      )}
    </div>
  )
}
