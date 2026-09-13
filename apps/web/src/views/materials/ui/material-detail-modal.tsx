'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Download, FileText, Link2, Trash2 } from 'lucide-react'
import { Button, FileUpload, Modal, useConfirm } from '../../../shared/ui'
import { useErrorToast } from '../../../shared/lib'
import {
  deleteMaterialRequest,
  fetchMaterialFileUrl,
  materialKeys,
  uploadMaterialFileRequest,
  type Material,
} from '../../../entities/material'

interface Props {
  material: Material
  canManage: boolean
  onClose: () => void
}

// Материал целиком: описание, ссылка, файлы и — у автора — загрузка и удаление.
// Зона загрузки живёт здесь, а не в строке списка: в списке она занимала полтораста
// пикселей у каждого материала и превращала экран в ленту пунктирных прямоугольников.
export function MaterialDetailModal({ material, canManage, onClose }: Props) {
  const t = useTranslations('Materials')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const errorToast = useErrorToast(`material-${material.id}`)
  const [downloading, setDownloading] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: materialKeys.all })

  const remove = useMutation({
    mutationFn: () => deleteMaterialRequest(material.id),
    onSuccess: () => {
      void invalidate()
      toast.success(t('deleted'))
      onClose()
    },
    onError: (e) => errorToast.show(e),
  })

  async function download(fileId: string): Promise<void> {
    setDownloading(fileId)
    try {
      const url = await fetchMaterialFileUrl(material.id, fileId)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      errorToast.show(e)
    } finally {
      setDownloading(null)
    }
  }

  const meta = [
    material.subject,
    `${material.teacher.lastName} ${material.teacher.firstName}`,
    new Date(material.createdAt).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
  ].filter(Boolean)

  return (
    <Modal onClose={onClose} title={material.title}>
      <div className="flex flex-col gap-4">
        <span className="text-xs text-muted-foreground">{meta.join(' · ')}</span>

        {/* Описание и ссылка — одной строкой: ссылка относится к материалу целиком,
            отдельной строкой под описанием она читалась как ещё один пункт содержимого. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          {material.description ? (
            <p className="min-w-0 flex-1 text-sm">{material.description}</p>
          ) : (
            <span className="flex-1" />
          )}
          {material.url && (
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" asChild>
              <a href={material.url} target="_blank" rel="noopener noreferrer">
                <Link2 className="size-4" aria-hidden />
                {t('openLink')}
              </a>
            </Button>
          )}
        </div>

        <hr className="border-border" />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{t('colFiles')}</span>
          {material.media.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noFiles')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {material.media.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{f.mime}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(f.size / 1024).toFixed(0)} КБ
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => download(f.id)}
                    disabled={downloading === f.id}
                    aria-label={t('download')}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Download className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canManage && (
          <FileUpload
            category="DOCUMENT"
            uploadFn={(file, onProgress) =>
              uploadMaterialFileRequest(material.id, file, onProgress)
            }
            onUploaded={() => {
              void invalidate()
              toast.success(t('fileAdded'))
            }}
            onError={(code) => toast.error(tErr(code))}
          />
        )}

        {/* Удаление — у левого края, закрытие у правого: разрушающее действие не должно
            стоять там, где обычно жмут «готово». */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canManage ? (
            <Button
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              loading={remove.isPending}
              onClick={() => {
                void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                  if (ok) remove.mutate()
                })
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t('delete')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
