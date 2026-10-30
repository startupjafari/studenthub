'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { formatCopyCode, type BookCopyLabel } from '../../../entities/library'

// Печатный лист наклеек экземпляров (Фаза 20.3). Интерфейс приложения при печати скрыт
// правилами @media print в globals.css, печатается только .sh-print-root.
//
// Наклейка на книгу маленькая: 24 на лист A4 (3 × 8) под разрезание. QR 25 мм берётся
// камерой телефона с полуметра — библиотекарь сканирует книгу в руках, а не со стены.
// Крупно — инвентарный номер: по нему книгу ищут на полке и сверяют с инвентарной книгой.

const PER_PAGE = 24

export function BookLabelSheet({ items }: { items: BookCopyLabel[] }) {
  const t = useTranslations('LibraryCatalog')
  const pages: BookCopyLabel[][] = []
  for (let i = 0; i < items.length; i += PER_PAGE) pages.push(items.slice(i, i + PER_PAGE))

  return (
    <div className="sh-print-root">
      {pages.map((page) => (
        <div
          key={page[0]?.copyId}
          className="sh-print-page mx-auto grid w-full max-w-[190mm] grid-cols-3 gap-0"
        >
          {page.map((item) => (
            <article
              key={item.copyId}
              // Пунктир — линия разреза.
              className="flex h-[34mm] items-center gap-2 border border-dashed border-slate-300 bg-white px-2 text-slate-900"
            >
              <Image
                src={item.qr}
                alt={t('labelQrAlt', { number: item.inventoryNumber })}
                width={96}
                height={96}
                unoptimized
                className="size-[25mm] shrink-0"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-[7pt] font-semibold tracking-[0.12em] text-blue-700 uppercase">
                  {item.university}
                </p>
                <p className="text-[14pt] leading-none font-bold tabular-nums">
                  {item.inventoryNumber}
                </p>
                <p className="line-clamp-2 text-[7.5pt] leading-tight">{item.title}</p>
                {item.authors && (
                  <p className="truncate text-[6.5pt] text-slate-500">{item.authors}</p>
                )}
                <p className="font-mono text-[6.5pt] tracking-[0.15em] text-slate-400">
                  {formatCopyCode(item.code)}
                </p>
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  )
}
