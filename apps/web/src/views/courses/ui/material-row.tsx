'use client'

import { useState } from 'react'
import type { useTranslations } from 'next-intl'
import { Download, FileText, Paperclip } from 'lucide-react'
import { fetchMaterialFileUrl, type Material } from '../../../entities/material'
import { Button } from '../../../shared/ui'

// Строка материала: название, автор и дата слева, ссылка и файлы справа. Общая для вкладки
// дисциплины и «Прочих материалов» на странице дисциплин.
export function MaterialRow({
  material,
  locale,
  t,
}: {
  material: Material
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const date = new Date(material.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })

  async function openFile(fileId: string) {
    setBusy(fileId)
    try {
      const url = await fetchMaterialFileUrl(material.id, fileId)
      window.open(url, '_blank', 'noopener')
    } finally {
      setBusy(null)
    }
  }

  return (
    // Одна строка: слева — что за материал, справа — чем его открыть. Раньше кнопки
    // стояли под названием с отступом слева, и строка выглядела ступенькой, а правая
    // половина карточки пустовала. На узком экране кнопки переносятся под текст.
    <li className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{material.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {material.teacher.firstName} {material.teacher.lastName} · {date}
          </p>
        </div>
      </div>
      {(material.media.length > 0 || material.url) && (
        <div className="flex flex-wrap gap-1.5 pl-6 sm:shrink-0 sm:justify-end sm:pl-0">
          {material.url && (
            <Button asChild variant="outline" size="sm" className="gap-1">
              <a href={material.url} target="_blank" rel="noopener noreferrer">
                <Paperclip className="size-3" aria-hidden />
                {t('link')}
              </a>
            </Button>
          )}
          {material.media.map((f, i) => (
            <Button
              key={f.id}
              variant="outline"
              size="sm"
              className="gap-1"
              loading={busy === f.id}
              onClick={() => openFile(f.id)}
            >
              <Download className="size-3" aria-hidden />
              {t('file', { n: i + 1 })}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}
