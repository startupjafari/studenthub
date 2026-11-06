'use client'

import { useQueryClient } from '@tanstack/react-query'
import { DOCUMENT_TEMPLATE_LIMITS } from '@studenthub/shared-config'
import type { DocumentTemplateDetail } from '@studenthub/shared-schemas'
import { FileUpload } from '../../../shared/ui'
import {
  documentTemplateKeys,
  uploadDocumentTemplateVersion,
} from '../../../entities/document-template'
import { useTemplateTexts } from '../lib/use-template-texts'

const DOCX = {
  mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  extensions: ['.docx'],
} as const

interface TemplateUploadProps {
  templateId: string
  onUploaded: (detail: DocumentTemplateDetail) => void
}

// Загрузка DOCX новой версией. Общий FileUpload сужен до .docx и предела шаблона; что не так
// с файлом (макросы, повреждён), объясняет текст по причине из ответа, а не общий «ошибка».
// Точный предел задаёт сервер (DOCUMENT_TEMPLATE_MAX_BYTES), здесь — потолок, выше которого
// отправлять бессмысленно.
export function TemplateUpload({ templateId, onUploaded }: TemplateUploadProps) {
  const qc = useQueryClient()
  const { errorText } = useTemplateTexts()

  return (
    <FileUpload
      category="DOCUMENT"
      accept={DOCX}
      maxBytes={DOCUMENT_TEMPLATE_LIMITS.MAX_BYTES_CEILING}
      describeError={errorText}
      uploadFn={(file, onProgress) => uploadDocumentTemplateVersion(templateId, file, onProgress)}
      onUploaded={(detail) => {
        qc.setQueryData(documentTemplateKeys.detail(templateId), detail)
        void qc.invalidateQueries({ queryKey: documentTemplateKeys.all })
        onUploaded(detail)
      }}
    />
  )
}
