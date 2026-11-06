'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import type { AnalyticsReportFormat, AnalyticsReportPeriod } from '@studenthub/shared-schemas'
import { exportAnalyticsReport } from '../../../entities/analytics'
import {
  Button,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { saveFile, useErrorToast } from '../../../shared/lib'

export interface ExportReportButtonProps {
  /**
   * Факультет отчёта — для админа вуза и платформы на экране аналитики факультета.
   * Не задан — область берёт сервер из токена (платформа, свой вуз, свой факультет, свои курсы).
   */
  facultyId?: string
  /** Нельзя выгрузить, пока не выбран факультет: без него отчёт ушёл бы по всему вузу. */
  disabled?: boolean
}

/**
 * «Выгрузить отчёт» в шапке сводки: кнопка открывает окно с периодом и форматом.
 *
 * Окно, а не две кнопки рядом: период у файла свой (дашборд показывает «сейчас»), и
 * человек должен видеть, за что именно получит числа, до того как скачает.
 */
export function ExportReportButton({ facultyId, disabled }: ExportReportButtonProps) {
  const t = useTranslations('AnalyticsReport')
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        size="md"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Download className="size-4" aria-hidden />
        {t('button')}
      </Button>
      {open && <ExportReportModal facultyId={facultyId} onClose={() => setOpen(false)} />}
    </>
  )
}

function ExportReportModal({ facultyId, onClose }: { facultyId?: string; onClose: () => void }) {
  const t = useTranslations('AnalyticsReport')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const { show } = useErrorToast('analytics-report')
  const [period, setPeriod] = useState<AnalyticsReportPeriod>('quarter')
  const [format, setFormat] = useState<AnalyticsReportFormat>('xlsx')

  const periods: { value: AnalyticsReportPeriod; label: string }[] = [
    { value: 'month', label: t('periodMonth') },
    { value: 'quarter', label: t('periodQuarter') },
    { value: 'year', label: t('periodYear') },
  ]
  const formats: { value: AnalyticsReportFormat; label: string }[] = [
    { value: 'xlsx', label: t('formatXlsx') },
    { value: 'csv', label: t('formatCsv') },
  ]

  const download = useMutation({
    mutationFn: () => exportAnalyticsReport({ period, format, locale, facultyId }),
    onSuccess: (file) => {
      saveFile(file)
      onClose()
    },
    onError: (e) => show(e),
  })

  return (
    <Modal onClose={onClose} title={t('title')} size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          download.mutate()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="analytics-report-period">{t('period')}</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as AnalyticsReportPeriod)}>
            <SelectTrigger id="analytics-report-period" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="analytics-report-format">{t('format')}</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as AnalyticsReportFormat)}>
            <SelectTrigger id="analytics-report-format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formats.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">{t('hint')}</p>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={download.isPending}>
            {t('submit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
