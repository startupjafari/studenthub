'use client'

import { useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Modal, useConfirm } from '../../../shared/ui'
import { CreatePostForm, type ComposerState, type CreatePostFormProps } from './create-post-form'

/** Окно редактора на телефоне — во весь экран: под текст и клавиатуру нужна вся высота. */
export const COMPOSER_MODAL_CLASS =
  'max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0 sm:max-h-[min(90vh,48rem)]'

/**
 * Окно публикации — одно на все входы (лента, профиль, страница вуза). Закрытие без
 * вопроса, когда терять нечего: текст уже лежит в черновике на устройстве. Спрашивает,
 * только если пропадут вложения (их в черновик не положить) или черновик не записался.
 */
export function PostComposerModal({
  onClose,
  title,
  ...formProps
}: Omit<CreatePostFormProps, 'onCreated' | 'onStateChange'> & {
  onClose: () => void
  title?: string
}) {
  const t = useTranslations('Feed')
  const confirm = useConfirm()
  const state = useRef<ComposerState>({ unsaved: false })
  const onStateChange = useCallback((next: ComposerState) => {
    state.current = next
  }, [])

  const requestClose = useCallback(() => {
    if (!state.current.unsaved) {
      onClose()
      return
    }
    void confirm({
      title: t('discardConfirmTitle'),
      description: t('discardConfirmText'),
      confirmLabel: t('discardConfirmAction'),
      cancelLabel: t('keepEditing'),
      destructive: true,
    }).then((ok) => {
      if (ok) onClose()
    })
  }, [confirm, onClose, t])

  return (
    <Modal
      onClose={requestClose}
      title={title ?? t('newPost')}
      size="xl"
      className={COMPOSER_MODAL_CLASS}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <CreatePostForm {...formProps} onCreated={onClose} onStateChange={onStateChange} />
    </Modal>
  )
}
