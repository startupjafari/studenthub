'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Keyboard, ScanLine } from 'lucide-react'
import { Button, Card, CardContent, Input, Label } from '../../../shared/ui'
import { formatRoomCode, isCompleteRoomCode, normalizeRoomCode } from '../lib/format-code'

// Ф16, продолжение: путь для заляпанного или ободранного QR. Код напечатан на наклейке
// текстом под кодом-картинкой, и до сих пор набрать его было некуда — оставалось искать
// помещение вручную. Экран открывается с телефона в коридоре, поэтому это одно поле и одна
// кнопка, без формы-обёртки и без лишней валидации: код или полный, или нет.
export function RoomCodeEntryView() {
  const t = useTranslations('Rooms')
  const router = useRouter()
  const [code, setCode] = useState('')

  const complete = isCompleteRoomCode(code)

  function submit() {
    if (complete) router.push(`/r/${code}`)
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pt-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <Keyboard className="size-7" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{t('manualTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('manualDescription')}</p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-code">{t('manualLabel')}</Label>
            <Input
              id="room-code"
              // Клавиатура телефона: буквы и цифры, но без автозамены и автокапитализации
              // «первая заглавная» — код и так приводится к верхнему регистру.
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              inputMode="text"
              enterKeyHint="go"
              placeholder={t('manualPlaceholder')}
              // Показываем с дефисом — как на наклейке, чтобы глаз сверял один в один.
              value={formatRoomCode(code)}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              className="text-center font-mono text-2xl tracking-[0.3em]"
              aria-describedby="room-code-hint"
            />
            <p id="room-code-hint" className="text-xs text-muted-foreground">
              {t('manualHint')}
            </p>
          </div>

          <Button onClick={submit} disabled={!complete} className="gap-2">
            <ScanLine className="size-4" aria-hidden />
            {t('manualSubmit')}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
