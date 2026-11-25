'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { postKeys, updatePostRequest, type FeedPost } from '../../../entities/post'
import { Button, FieldError, Input, Modal, RichTextField } from '../../../shared/ui'
import { useErrorToast } from '../../../shared/lib'

/**
 * Правка своей публикации: заголовок и текст.
 *
 * Аудитория и вложения не меняются намеренно. Смена аудитории после публикации
 * перекроила бы круг тех, кто пост уже видел и обсудил, а подмена вложений — это
 * уже другой пост, а не правка опечатки.
 *
 * Раскладка повторяет окно создания (`CreatePostForm`): заголовок и текст без рамок
 * «формы», внизу одно главное действие. Разные формы для одного и того же текста читались
 * бы как разные инструменты.
 */
export function EditPostModal({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { show } = useErrorToast('edit-post')

  const [title, setTitle] = useState(post.title ?? '')
  const [content, setContent] = useState(post.content)

  const save = useMutation({
    mutationFn: () =>
      updatePostRequest(post.id, { title: title.trim() || null, content: content.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('postUpdated'))
      onClose()
    },
    onError: (e) => show(e),
  })

  // Заметка репоста необязательна (как при репосте) — её можно и стереть; у обычного
  // поста без текста публиковать нечего.
  const empty = !post.originalPostId && content.trim().length === 0

  return (
    <Modal
      onClose={onClose}
      title={t('editPost')}
      size="xl"
      className="max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0 sm:max-h-[min(90vh,48rem)]"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!empty) save.mutate()
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Заголовок и текст — без рамок «формы», как в окне создания. */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pt-4 pb-3 sm:px-5">
          <Input
            id="edit-title"
            aria-label={t('titleLabel')}
            placeholder={t('titleOptional')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="h-auto rounded-none border-transparent bg-transparent px-0 py-1 text-lg font-semibold shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
          />
          <RichTextField
            id="edit-content"
            aria-label={t('contentLabel')}
            value={content}
            onChange={setContent}
            placeholder={t('placeholder')}
            bare
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                if (!empty) save.mutate()
                return true
              }
              return false
            }}
            className="max-h-[55dvh] min-h-28 overflow-y-auto px-0 text-[0.9375rem]"
          />
          <FieldError>{empty && t('contentRequired')}</FieldError>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="ghost" onClick={onClose} className="h-10 rounded-full">
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={empty}
            className="h-10 rounded-full px-5"
          >
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
