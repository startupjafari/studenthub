'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { DocumentTemplateDetail } from '@studenthub/shared-schemas'
import {
  deleteDocumentTemplate,
  documentTemplateKeys,
  downloadDocumentTemplateTest,
  fetchDocumentTemplateSource,
  generateDocumentFromTemplate,
  publishDocumentTemplate,
  unpublishDocumentTemplate,
} from '../../../entities/document-template'
import { saveBlob } from '../../../shared/lib'
import { useTemplateTexts } from './use-template-texts'

/** Действия над шаблоном: каждое с обработкой ошибки и целевой инвалидацией кэша. */
export function useTemplateActions(id: string) {
  const t = useTranslations('DocumentTemplates')
  const qc = useQueryClient()
  const { errorToast } = useTemplateTexts()

  const applyDetail = (detail: DocumentTemplateDetail) => {
    qc.setQueryData(documentTemplateKeys.detail(id), detail)
    void qc.invalidateQueries({ queryKey: documentTemplateKeys.all })
  }

  const test = useMutation({
    mutationFn: (versionId?: string) => downloadDocumentTemplateTest(id, versionId),
    onSuccess: (file) => {
      void saveBlob(file.blob, file.filename)
      toast.success(t('testDownloaded'))
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  const publish = useMutation({
    mutationFn: () => publishDocumentTemplate(id),
    onSuccess: (detail) => {
      applyDetail(detail)
      toast.success(t('publishedToast'))
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  const unpublish = useMutation({
    mutationFn: () => unpublishDocumentTemplate(id),
    onSuccess: (detail) => {
      applyDetail(detail)
      toast.success(t('unpublishedToast'))
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  const remove = useMutation({
    mutationFn: () => deleteDocumentTemplate(id),
    onSuccess: ({ archived }) => {
      void qc.invalidateQueries({ queryKey: documentTemplateKeys.all })
      toast.success(archived ? t('archivedToast') : t('deletedToast'))
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  // Исходник — по подписанной ссылке: файл отдаёт хранилище, а не API.
  const source = useMutation({
    mutationFn: (versionId: string) => fetchDocumentTemplateSource(id, versionId),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: (e) => toast.error(errorToast(e)),
  })

  const generate = useMutation({
    mutationFn: (studentId: string) => generateDocumentFromTemplate(id, studentId),
    onSuccess: (file) => {
      void saveBlob(file.blob, file.filename)
      void qc.invalidateQueries({ queryKey: documentTemplateKeys.detail(id) })
      toast.success(t('generatedToast'))
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  return { test, publish, unpublish, remove, source, generate }
}
