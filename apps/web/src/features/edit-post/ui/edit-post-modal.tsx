'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { postKeys, updatePostRequest, type FeedPost } from '../../../entities/post'
import { Button, FieldError, FormAlert, Input, MarkdownEditor, Modal } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

/**
 * Правка своей публикации: заголовок и текст.
 *
 * Аудитория и вложения не меняются намеренно. Смена аудитории после публикации
 * перекроила бы круг тех, кто пост уже видел и обсудил, а подмена вложений — это
 * уже другой пост, а не правка опечатки.
 *
 * Раскладка повторяет окно создания (`CreatePostForm`): заголовок и текст — один
 * блок без внутренних рамок, панель форматирования всплывает над выделением.
 * Разные формы для одного и того же текста читались бы как разные инструменты.
 */
export function EditPostModal({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { error, show, reset } = useFormAlert()

  const [title, setTitle] = useState(post.title ?? '')
  const [content, setContent] = useState(post.content)

  const save = useMutation({
    mutationFn: () =>
      updatePostRequest(post.id, { title: title.trim() || null, content: content.trim() }),
    onMutate: () => reset(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('postUpdated'))
      onClose()
    },
    onError: (e) => show(e),
  })

  const empty = content.trim().length === 0

  return (
    <Modal
      onClose={onClose}
      title={t('editPost')}
      size="2xl"
      className="max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!empty) save.mutate()
        }}
        className="flex flex-col gap-3 sm:px-2"
      >
        <FormAlert error={error} />

        {/* Заголовок и текст — один блок с общей рамкой, как в окне создания. */}
        <div className="flex flex-col rounded-xl border border-input bg-background transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 dark:bg-input/30">
          <Input
            id="edit-title"
            aria-label={t('titleLabel')}
            placeholder={t('titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            // Рамку и фокус держит блок целиком — у заголовка своих границ нет.
            className="h-auto rounded-none border-transparent bg-transparent px-3 pt-3 pb-1 text-lg font-semibold hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
          />
          <MarkdownEditor
            id="edit-content"
            aria-label={t('contentLabel')}
            value={content}
            onChange={setContent}
            placeholder={t('placeholder')}
            autoGrow
            bare
            rows={3}
            className="max-h-[45vh] min-h-28"
          />
        </div>
        <FieldError>{empty && t('contentRequired')}</FieldError>

        <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-border bg-card px-1 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-between sm:pb-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={empty}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
          >
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
