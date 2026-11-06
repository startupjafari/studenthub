'use client'

import { useTranslations } from 'next-intl'
import { documentTemplateVariable } from '@studenthub/shared-config'
import type { DocumentTemplateIssue } from '@studenthub/shared-schemas'

/** Ключ словаря для переменной: в next-intl точка — разделитель вложенности. */
export function varKey(key: string): string {
  return key.replace(/\./g, '_')
}

/** Как переменную пишут в Word. */
export function asTag(key: string): string {
  return `{${key}}`
}

/**
 * Человеческие тексты модуля: подписи переменных, замечания проверки, причины отказа в
 * файле. Сервер отдаёт коды — тексты живут здесь, в словарях (FRONTEND_RULES §10).
 */
export function useTemplateTexts() {
  const t = useTranslations('DocumentTemplates')
  const tErr = useTranslations('Errors')

  const variableLabel = (key: string): string =>
    documentTemplateVariable(key) ? t(`var_${varKey(key)}_label`) : key

  const where = (part: DocumentTemplateIssue['part']): string =>
    part && part !== 'body' ? ` ${t(`part_${part}`)}` : ''

  const issueText = (issue: DocumentTemplateIssue): string => {
    const tag = issue.tag ?? ''
    switch (issue.code) {
      case 'SYNTAX':
        return t('issue_SYNTAX', { where: where(issue.part) })
      case 'UNKNOWN_VARIABLE':
        return t('issue_UNKNOWN_VARIABLE', { tag: asTag(tag), where: where(issue.part) })
      case 'UNSUPPORTED_TAG':
        return t('issue_UNSUPPORTED_TAG', { tag: asTag(tag) })
      case 'TOO_MANY_TAGS':
        return t('issue_TOO_MANY_TAGS')
      case 'NO_VARIABLES':
        return t('issue_NO_VARIABLES')
      case 'OPTIONAL_VARIABLE':
        return t('issue_OPTIONAL_VARIABLE', { label: variableLabel(tag) })
      case 'PERSONAL_DATA':
        return t('issue_PERSONAL_DATA')
      case 'MORE_ISSUES':
        return t('issue_MORE_ISSUES', { count: Number(tag) || 0 })
    }
  }

  /**
   * Подробный текст ошибки запроса: причина отказа в файле, незаполненные поля студента.
   * null — подойдёт общий текст по коду.
   */
  const errorText = (error: unknown): string | null => {
    const e = error as { code?: string; details?: { field: string; message: string }[] }
    const details = e.details ?? []
    if (e.code === 'TEMPLATE_FILE_INVALID' && details[0]) {
      return t(`fileProblem_${details[0].message}`)
    }
    if (e.code === 'TEMPLATE_DATA_MISSING' && details.length > 0) {
      return t('dataMissing', { fields: details.map((d) => variableLabel(d.field)).join(', ') })
    }
    if (e.code === 'TEMPLATE_INVALID' && details[0]?.message === 'NO_FILE') return t('noFileYet')
    return null
  }

  /** Текст для тоста: подробный, если он есть, иначе общий по коду. */
  const errorToast = (error: unknown): string =>
    errorText(error) ?? tErr((error as { code?: string }).code ?? 'INTERNAL_ERROR')

  return { variableLabel, issueText, errorText, errorToast }
}
