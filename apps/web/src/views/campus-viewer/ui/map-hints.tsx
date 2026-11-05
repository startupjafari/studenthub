'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Keyboard } from 'lucide-react'
import { cn } from '../../../shared/lib'

const STORAGE_KEY = 'campus-map-hints-collapsed'

type Row = { keys: ReactNode[][]; action: string }

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[0.6875rem] whitespace-nowrap text-muted-foreground">
      {children}
    </kbd>
  )
}

/**
 * Подсказки управления картой — слева внизу. Свёрнутость помнится в браузере. На сенсорных
 * экранах не показываем: там мышь и клавиши ни при чём, а карта и так невелика.
 */
export function MapHints({ mode }: { mode: '2d' | '3d' | 'campus' }) {
  const t = useTranslations('CampusMap')
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // Хранилище недоступно (приватное окно) — просто развёрнуты.
    }
  }, [])
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Не запомнили — не страшно.
    }
  }

  const scene = mode !== '2d'
  const rows: Row[] = [
    { keys: [[t('keyClick')]], action: t('actSelect') },
    ...(scene
      ? [
          { keys: [[t('keyLmb')]], action: t('actRotate') },
          { keys: [[t('keyRmb')], ['Shift', t('keyLmb')]], action: t('actPan') },
          { keys: [[t('keyWheel')]], action: t('actZoomCursor') },
          { keys: [[t('keyDblClick')]], action: t('actFlyTo') },
        ]
      : [
          { keys: [[t('keyDrag')]], action: t('actPan') },
          { keys: [[t('keyWheel')]], action: t('actZoom') },
          { keys: [[t('keyDblClick')]], action: t('actZoomIn') },
        ]),
    { keys: [['W', 'A', 'S', 'D'], ['←↑↓→']], action: t('actPan') },
    ...(scene
      ? [
          {
            keys: [
              ['Q', 'E'],
              ['Shift', '←→'],
            ],
            action: t('actRotate'),
          },
          {
            keys: [
              ['R', 'F'],
              ['Shift', '↑↓'],
            ],
            action: t('actTilt'),
          },
        ]
      : []),
    { keys: [['+', '−']], action: t('actZoom') },
    { keys: [['0']], action: scene ? t('actOverview') : t('actFitAll') },
    { keys: [['PgUp', 'PgDn']], action: t('actFloor') },
    { keys: [['Esc']], action: t('actDeselect') },
  ]

  return (
    <div className="absolute bottom-3 left-3 hidden max-w-[calc(100%-6rem)] rounded-xl bg-card/95 text-xs shadow-sm ring-1 ring-foreground/10 backdrop-blur pointer-fine:block">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={toggle}
        className="flex h-9 w-full items-center gap-2 rounded-xl px-3 font-medium hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none"
      >
        <Keyboard className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-left">{t('hintsTitle')}</span>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            collapsed && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1.5 px-3 pt-1 pb-3">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
            {rows.map((r, i) => (
              <Fragment key={i}>
                <dt className="flex flex-wrap items-center gap-1">
                  {r.keys.map((combo, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span className="text-muted-foreground">/</span>}
                      {combo.map((k, n) => (
                        <Fragment key={n}>
                          {n > 0 && combo[0] === 'Shift' && (
                            <span className="text-muted-foreground">+</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </dt>
                <dd className="text-muted-foreground">{r.action}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="max-w-64 text-muted-foreground/80">{t('hintsFocus')}</p>
        </div>
      )}
    </div>
  )
}
