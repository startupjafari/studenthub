'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ChevronRight, Forward, Trash2 } from 'lucide-react'

import {
  MediaViewer,
  ScreenStack,
  type MediaViewerAction,
  type ScreenStackHandle,
} from '../../../shared/ui'
import { identityAccent, identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { Caption, Code, Demo, Pitfall, Section } from './kit'

// Общие примитивы, пришедшие с переводом чатов на раскладку Telegram: стек экранов,
// акцент личности, просмотрщик медиа с полётом из миниатюры и действиями.

const PEOPLE = [
  { id: 'u-aigerim', name: 'Айгерим Сапарова' },
  { id: 'u-timur', name: 'Тимур Ахметов' },
  { id: 'u-dana', name: 'Дана Ким' },
  { id: 'u-ruslan', name: 'Руслан Беков' },
]

// Снимок для просмотрщика — встроенный SVG: у витрины нет своих файлов в хранилище, а
// внешний адрес сделал бы пример зависимым от сети.
const DEMO_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#bfdbfe"/></linearGradient></defs>' +
    '<rect width="1200" height="800" fill="url(#s)"/><circle cx="900" cy="220" r="90" fill="#fde68a"/>' +
    '<path d="M0 620 L260 380 L470 560 L700 300 L1000 600 L1200 470 L1200 800 L0 800Z" fill="#166534"/>' +
    '<path d="M0 700 L320 520 L620 690 L900 560 L1200 720 L1200 800 L0 800Z" fill="#14532d"/></svg>',
)}`

/** Живой пример ScreenStack: список внизу, «переписка» въезжает поверх. */
function ScreenStackDemo() {
  const [openId, setOpenId] = useState<string | null>(null)
  const stackRef = useRef<ScreenStackHandle | null>(null)
  const person = PEOPLE.find((p) => p.id === openId)

  const list = (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-3 py-2.5 text-sm font-bold">Чаты</div>
      {PEOPLE.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setOpenId(p.id)}
          className="flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
              identityColor(p.id),
            )}
          >
            {identityInitials(p.name)}
          </span>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </button>
      ))}
    </div>
  )

  const top = person && (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          type="button"
          aria-label="Назад"
          // Через ручку стека — экран уезжает, а не пропадает кадром.
          onClick={() => stackRef.current?.close()}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <span className="truncate text-sm font-bold">{person.name}</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Верхний экран. На телефоне — свайп от левого края назад; едущий экран можно схватить.
      </div>
    </div>
  )

  return (
    <ScreenStack
      open={!!openId}
      onClose={() => setOpenId(null)}
      handleRef={stackRef}
      className="h-72 w-full max-w-sm flex-col rounded-xl ring-1 ring-foreground/10"
      base={list}
      top={top}
    />
  )
}

/** Имя, полоса и подложка цитаты — цветом человека, тем же, что у его кружка. */
function IdentityAccentDemo() {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      {PEOPLE.map((p) => {
        const accent = identityAccent(p.id)
        return (
          <div key={p.id} className="flex items-start gap-2">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
                identityColor(p.id),
              )}
            >
              {identityInitials(p.name)}
            </span>
            <div className="flex min-w-0 flex-col gap-1 rounded-2xl rounded-bl-sm bg-muted px-2.5 py-1.5 text-sm">
              <span className={cn('truncate text-[13px] font-semibold', accent.text)}>
                {p.name}
              </span>
              <div className={cn('flex overflow-hidden rounded-md', accent.tint)}>
                <span className={cn('w-[3px] shrink-0', accent.bar)} aria-hidden />
                <span className="min-w-0 px-2 py-1 text-xs">
                  <span className={cn('block truncate font-semibold', accent.text)}>{p.name}</span>
                  <span className="block truncate text-muted-foreground">Цитата ответа</span>
                </span>
              </div>
              <span>Сообщение в группе</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Просмотрщик: снимок вырастает из миниатюры и садится обратно, действия в шапке. */
function MediaViewerDemo() {
  const [open, setOpen] = useState(false)
  const thumbRef = useRef<HTMLButtonElement>(null)
  const menu: MediaViewerAction[] = [
    { key: 'forward', label: 'Переслать', icon: Forward, onSelect: () => toast('Переслать') },
    {
      key: 'delete',
      label: 'Удалить',
      icon: Trash2,
      tone: 'danger',
      closes: true,
      onSelect: () => toast('Удалить'),
    },
  ]
  return (
    <>
      <button
        ref={thumbRef}
        type="button"
        onClick={() => setOpen(true)}
        className="overflow-hidden rounded-xl ring-1 ring-foreground/10 transition-transform active:scale-95"
        aria-label="Открыть снимок"
      >
        <img src={DEMO_PHOTO} alt="" width={180} height={120} className="block" />
      </button>
      <Caption>
        Нажмите на миниатюру: открытие — полёт из неё, закрытие (крестик, Esc, смахивание) —
        обратно.
      </Caption>
      {open && (
        <MediaViewer
          items={[{ mime: 'image/svg+xml', name: 'Пейзаж' }]}
          index={0}
          src={DEMO_PHOTO}
          onIndexChange={() => {}}
          onClose={() => setOpen(false)}
          menu={menu}
          getOrigin={() => thumbRef.current}
        />
      )}
    </>
  )
}

export function TgPrimitivesSection() {
  return (
    <Section
      id="tg-primitives"
      title="Стек экранов, личность, просмотрщик"
      note="Общие примитивы, пришедшие с раскладкой чатов в духе Telegram. Подробно — docs/DESIGN_SYSTEM.md §2.2, §7.1, §9."
    >
      <Demo
        label="ScreenStack"
        rule={
          <>
            Два экрана в одной колонке: верхний въезжает справа, нижний отступает и темнеет. Кнопка
            «назад» — <Code>handleRef.current.close()</Code>, системная «назад» —{' '}
            <Code>backClose</Code>. Своя раскладка — <Code>useScreenStack</Code> +{' '}
            <Code>BackCloseWhileOpen</Code>.
          </>
        }
      >
        <ScreenStackDemo />
      </Demo>
      <Pitfall>
        Не закрывать верхний экран сменой состояния напрямую из кнопки «назад»: экран пропадёт
        кадром. Закрытие идёт через ручку стека, а <Code>onClose</Code> зовётся, когда уезд доехал.
      </Pitfall>

      <Demo
        label="identityAccent"
        rule={
          <>
            <Code>{'{ text, bar, tint }'}</Code> — имя автора, полоса и подложка цитаты цветом
            человека; оттенок тот же, что у <Code>identityColor</Code> на кружке.
          </>
        }
      >
        <IdentityAccentDemo />
      </Demo>

      <Demo
        label="MediaViewer: getOrigin и menu"
        rule={
          <>
            <Code>getOrigin(index)</Code> — миниатюра для полёта; <Code>MediaViewerAction</Code> —
            действия: на ПК иконками в шапке, на телефоне — пунктами «⋮».
          </>
        }
      >
        <MediaViewerDemo />
      </Demo>
    </Section>
  )
}
