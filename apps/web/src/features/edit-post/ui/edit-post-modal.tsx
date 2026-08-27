'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { postKeys, updatePostRequest, type FeedPost } from '../../../entities/post'
import {
  Button,
  FieldError,
  FormAlert,
  Input,
  Label,
  MarkdownEditor,
  Modal,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

/**
 * Правка своей публикации: заголовок и текст.
 *
 * Аудитория и вложения не меняются намеренно. Смена аудитории после публикации
 * перекроила бы круг тех, кто пост уже видел и обсудил, а подмена вложений — это
 * уже другой пост, а не правка опечатки.
 */
export function EditPostModal({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const tEditor = useTranslations('Editor')
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
        className="flex flex-col gap-4"
      >
        <FormAlert error={error} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-title">{t('titleLabel')}</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-content">{t('contentLabel')}</Label>
          <MarkdownEditor
            id="edit-content"
            value={content}
            onChange={setContent}
            placeholder={t('placeholder')}
            hint={tEditor('markdownHint')}
          />
          <FieldError>{empty && t('contentRequired')}</FieldError>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={empty}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
