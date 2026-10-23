'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { ScanQrCode, X } from 'lucide-react'
import { Badge, Button, Input, Label, Modal, Skeleton } from '../../../shared/ui'
import { formatCopyCode } from '../../../entities/library'
import { parseQrTarget } from '../../../features/qr-scan'

const QrScanner = dynamic(() => import('../../../features/qr-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />,
})

/** Что выбрано: код отсканированной наклейки или введённый инвентарный номер. */
export interface CopyRef {
  copyCode: string | null
  inventoryNumber: string
}

export function copyRefInput(ref: CopyRef): { copyCode: string } | { inventoryNumber: string } {
  return ref.copyCode ? { copyCode: ref.copyCode } : { inventoryNumber: ref.inventoryNumber.trim() }
}

export function hasCopyRef(ref: CopyRef): boolean {
  return Boolean(ref.copyCode || ref.inventoryNumber.trim())
}

/**
 * Экземпляр для выдачи или возврата: скан наклейки (основной путь) или инвентарный номер,
 * когда наклейка стёрлась. Код и номер не смешиваются в одном поле: восьмизначный номер
 * вроде «23456789» неотличим от кода наклейки.
 */
export function CopyPicker({
  value,
  onChange,
}: {
  value: CopyRef
  onChange: (v: CopyRef) => void
}) {
  const t = useTranslations('LibraryDesk')
  const tScan = useTranslations('QrScan')
  const [scanning, setScanning] = useState(false)
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="copy-ref">{t('copyField')}</Label>
        {value.copyCode ? (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border px-3">
            <Badge variant="secondary" className="font-mono">
              {formatCopyCode(value.copyCode)}
            </Badge>
            <span className="text-sm text-muted-foreground">{t('copyScanned')}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              className="ml-auto"
              aria-label={t('clearCopy')}
              onClick={() => onChange({ copyCode: null, inventoryNumber: '' })}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <Input
            id="copy-ref"
            value={value.inventoryNumber}
            onChange={(e) => {
              // Ручной сканер «печатает» ссылку с наклейки в это поле — это код экземпляра,
              // а не инвентарный номер.
              const target = parseQrTarget(e.target.value.trim())
              if (target?.kind === 'bookCopy') {
                onChange({ copyCode: target.value, inventoryNumber: '' })
                return
              }
              onChange({ copyCode: null, inventoryNumber: e.target.value })
            }}
            placeholder={t('inventoryPlaceholder')}
          />
        )}
      </div>
      <div className="flex items-end">
        <Button type="button" variant="outline" onClick={() => setScanning(true)}>
          <ScanQrCode className="size-4" aria-hidden />
          {t('scanCopy')}
        </Button>
      </div>
      {scanning && (
        <Modal onClose={() => setScanning(false)} title={t('scanCopy')} size="lg">
          <div className="flex h-[60vh] flex-col">
            <QrScanner
              title={t('scanCopyTitle')}
              hint={t('scanCopyHint')}
              rejectNotice={tScan('notStudentHub')}
              onScan={(raw) => {
                const target = parseQrTarget(raw)
                if (target?.kind !== 'bookCopy') return false
                onChange({ copyCode: target.value, inventoryNumber: '' })
                setScanning(false)
                return true
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
