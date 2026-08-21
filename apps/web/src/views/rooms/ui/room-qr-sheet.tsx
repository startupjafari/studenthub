'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { GraduationCap, ScanLine } from 'lucide-react'
import { isAcademicRoomKind } from '@studenthub/shared-schemas'
import type { RoomQr } from '../../../entities/room'
import { formatRoomCode } from '../lib/format-code'

// Ф16: печатный лист наклеек. Интерфейс приложения при печати скрыт правилами
// @media print в globals.css, печатается только .sh-print-root.
//
// Две раскладки:
//   full    — одна наклейка на страницу A4: крупный номер читается издалека, QR 62 мм
//             (сканируется с ~1.5 м обычной камерой);
//   compact — четыре наклейки на страницу под разрезание. Нужна, когда вуз обходит
//             корпус и клеит коды десятками: раньше на 40 помещений уходило 40 листов.
//             QR здесь 45 мм — с расстояния вытянутой руки берётся так же, а вот номер
//             помещения издалека уже не прочитать, поэтому это не замена full-режиму.
export type QrSheetLayout = 'full' | 'compact'

/** Сколько наклеек влезает на A4 в компактном режиме (2×2 с полем под разрез). */
const COMPACT_PER_PAGE = 4

export function RoomQrSheet({
  items,
  layout = 'full',
}: {
  items: RoomQr[]
  layout?: QrSheetLayout
}) {
  const t = useTranslations('Rooms')

  if (layout === 'compact') {
    const pages: RoomQr[][] = []
    for (let i = 0; i < items.length; i += COMPACT_PER_PAGE) {
      pages.push(items.slice(i, i + COMPACT_PER_PAGE))
    }
    return (
      <div className="sh-print-root">
        {pages.map((page) => (
          <div
            key={page[0]?.roomId}
            className="sh-print-page mx-auto grid w-full max-w-[190mm] grid-cols-2 gap-0"
          >
            {page.map((item) => (
              <article
                key={item.roomId}
                // Пунктир — линия разреза: без неё непонятно, где резать лист.
                className="flex flex-col items-center border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-slate-900"
              >
                <p className="text-[9pt] font-semibold tracking-[0.16em] text-blue-700 uppercase">
                  {t(`kind.${item.kind}`)}
                </p>
                <h2 className="mt-1 text-[28pt] leading-none font-bold tracking-tight">
                  {item.name}
                </h2>
                {(item.building || item.floor !== null) && (
                  <p className="mt-1 text-[9pt] text-slate-500">
                    {[
                      item.building ? t('buildingValue', { value: item.building }) : null,
                      item.floor !== null ? t('floorValue', { value: item.floor }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                  <Image
                    src={item.qr}
                    alt={t('qrAlt', { room: item.name })}
                    width={170}
                    height={170}
                    unoptimized
                    className="size-[45mm]"
                  />
                </div>
                <p className="mt-2 text-[9pt] font-semibold text-blue-700">{t('scanCta')}</p>
                <p className="mt-1 font-mono text-[8pt] tracking-[0.2em] text-slate-400">
                  {formatRoomCode(item.code)}
                </p>
              </article>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="sh-print-root">
      {items.map((item) => (
        <article
          key={item.roomId}
          className="sh-print-page relative mx-auto flex w-full max-w-[190mm] flex-col items-center overflow-hidden rounded-3xl border border-border bg-white px-10 py-12 text-center text-slate-900"
        >
          {/* Верхний акцент — та же синяя палитра, что и в приложении. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600"
          />

          <div className="flex items-center gap-2 text-slate-500">
            <GraduationCap className="size-5 text-blue-600" aria-hidden />
            <span className="text-xs font-semibold tracking-[0.2em] uppercase">
              {item.universityShort ?? item.university}
            </span>
          </div>

          {/* Назначение помещения — чтобы наклейка читалась и без сканирования. */}
          <p className="mt-8 text-sm font-medium tracking-[0.18em] text-blue-700 uppercase">
            {t(`kind.${item.kind}`)}
          </p>
          <h1 className="mt-1 text-[64pt] leading-none font-bold tracking-tight text-slate-900">
            {item.name}
          </h1>
          {(item.building || item.floor !== null) && (
            <p className="mt-3 text-base text-slate-500">
              {[
                item.building ? t('buildingValue', { value: item.building }) : null,
                item.floor !== null ? t('floorValue', { value: item.floor }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {/* Часы работы — на самой наклейке: у двери библиотеки или бухгалтерии это
              нужнее, чем возможность отсканировать код. */}
          {item.openHours && (
            <p className="mt-4 max-w-[130mm] text-base font-medium text-slate-700">
              {item.openHours}
            </p>
          )}

          {/* QR в рамке: белое поле вокруг кода обязательно, иначе камера не находит границы. */}
          <div className="mt-8 rounded-3xl border-2 border-slate-200 bg-white p-4">
            <Image
              src={item.qr}
              alt={t('qrAlt', { room: item.name })}
              width={236}
              height={236}
              unoptimized
              className="size-[62mm]"
            />
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-blue-700">
            <ScanLine className="size-5" aria-hidden />
            <p className="text-lg font-semibold">{t('scanCta')}</p>
          </div>
          {/* У библиотеки или бухгалтерии занятий не бывает — обещать «какая пара идёт»
              на их наклейке нельзя. */}
          <p className="mt-2 max-w-[120mm] text-sm text-slate-600">
            {isAcademicRoomKind(item.kind) ? t('scanHint') : t('scanHintService')}
          </p>

          <div className="mt-auto pt-10">
            <p className="font-mono text-sm tracking-[0.25em] text-slate-400">
              {formatRoomCode(item.code)}
            </p>
            <p className="mt-1 text-xs text-slate-400">StudentHub</p>
          </div>
        </article>
      ))}
    </div>
  )
}
