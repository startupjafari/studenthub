'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { MessageSquare, Paperclip, Pin, Repeat2, Send, Share2, Trash2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  addCommentRequest,
  addReactionRequest,
  canRepost,
  deleteCommentRequest,
  deletePostRequest,
  fetchComments,
  pinPostRequest,
  postKeys,
  removeReactionRequest,
  type FeedPost,
  type PostReaction,
} from '../../../entities/post'
import {
  chatKeys,
  fetchChats,
  sharePostRequest,
  ForwardDialog,
  type ChatListItem,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { RepostDialog } from '../../../features/repost-post'
import { Avatar, AvatarFallback, Button, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Заголовок чата для пикера пересылки: явный title → предмет → «личный чат».
function chatLabel(c: ChatListItem, tChats: (k: string) => string): string {
  return c.title || c.subject || tChats('typePrivate')
}

const PRESET_EMOJIS = ['👍', '❤️', '🎉', '👏']
const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

export function PostCard({ post }: { post: FeedPost }) {
  const t = useTranslations('Feed')
  const tChats = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [reactions, setReactions] = useState<PostReaction[]>(post.reactions)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [reposting, setReposting] = useState(false)

  const chats = useQuery({ queryKey: chatKeys.list(), queryFn: fetchChats, enabled: sharing })
  const shareMut = useMutation({
    mutationFn: (chatId: string) => sharePostRequest(chatId, post.id),
    onSuccess: () => {
      setSharing(false)
      toast.success(t('sharedToChat'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const canModerate = myRole !== null && MODERATOR_ROLES.includes(myRole)
  const canDelete = post.authorId === myId || canModerate
  const showRepost = canRepost(myRole, post)

  const groups = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>()
    for (const r of reactions) {
      const g = map.get(r.emoji) ?? { count: 0, mine: false }
      g.count += 1
      if (r.userId === myId) g.mine = true
      map.set(r.emoji, g)
    }
    return map
  }, [reactions, myId])

  // Оптимистичная реакция с откатом (docs/FRONTEND_RULES.md §5.5).
  function toggleReaction(emoji: string): void {
    if (!myId) return
    const mine = reactions.some((r) => r.emoji === emoji && r.userId === myId)
    const prev = reactions
    if (mine) {
      setReactions(prev.filter((r) => !(r.emoji === emoji && r.userId === myId)))
      removeReactionRequest(post.id, emoji).catch(() => {
        setReactions(prev)
        toast.error(tErr('INTERNAL_ERROR'))
      })
    } else {
      setReactions([...prev, { emoji, userId: myId }])
      addReactionRequest(post.id, emoji).catch(() => {
        setReactions(prev)
        toast.error(tErr('INTERNAL_ERROR'))
      })
    }
  }

  const deleteMut = useMutation({
    mutationFn: () => deletePostRequest(post.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const pinMut = useMutation({
    mutationFn: () => pinPostRequest(post.id, post.pinnedAt === null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postKeys.all }),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const time = new Date(post.createdAt).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-border bg-card p-4',
        post.pinnedAt && 'border-primary/40',
      )}
    >
      <header className="flex items-center gap-3">
        <ProfileLink userId={post.author.id} className="shrink-0">
          <Avatar className="size-9">
            <AvatarFallback>{initials(post.author)}</AvatarFallback>
          </Avatar>
        </ProfileLink>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            <ProfileLink userId={post.author.id} className="hover:text-primary hover:underline">
              {post.author.lastName} {post.author.firstName}
            </ProfileLink>
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`audience${post.audience}`)} · {time}
          </p>
        </div>
        {post.pinnedAt && <Pin className="size-4 text-primary" aria-hidden />}
        {canModerate && (
          <button
            type="button"
            aria-label={t('pin')}
            onClick={() => pinMut.mutate()}
            className="cursor-pointer text-muted-foreground hover:text-primary"
          >
            <Pin className={cn('size-4', post.pinnedAt && 'fill-current')} aria-hidden />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            aria-label={t('delete')}
            onClick={() => {
              void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                if (ok) deleteMut.mutate()
              })
            }}
            className="cursor-pointer text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </header>

      {post.content && <p className="text-sm whitespace-pre-wrap">{post.content}</p>}

      {post.original && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat2 className="size-3.5" aria-hidden />
            <ProfileLink
              userId={post.original.author.id}
              className="hover:text-primary hover:underline"
            >
              {post.original.author.lastName} {post.original.author.firstName}
            </ProfileLink>
          </p>
          <p className="whitespace-pre-wrap">{post.original.content}</p>
        </div>
      )}

      {post.media.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5" aria-hidden />
          {t('mediaCount', { count: post.media.length })}
        </p>
      )}

      {/* Реакции */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESET_EMOJIS.map((emoji) => {
          const g = groups.get(emoji)
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleReaction(emoji)}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors',
                g?.mine ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              <span>{emoji}</span>
              {g && g.count > 0 && <span className="text-xs text-muted-foreground">{g.count}</span>}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setCommentsOpen((v) => !v)}
          className="ml-2 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          {post._count.comments}
        </button>
        {showRepost && (
          <button
            type="button"
            aria-label={t('repost')}
            onClick={() => setReposting(true)}
            className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Repeat2 className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('repost')}</span>
          </button>
        )}
        <button
          type="button"
          aria-label={t('shareToChat')}
          onClick={() => setSharing(true)}
          className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Share2 className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('share')}</span>
        </button>
      </div>

      {commentsOpen && <Comments postId={post.id} />}

      {reposting && <RepostDialog post={post} onClose={() => setReposting(false)} />}

      {sharing && (
        <ForwardDialog
          chats={chats.data ?? []}
          currentChatId={null}
          titleOf={(c) => chatLabel(c, tChats)}
          onPick={(chatId) => shareMut.mutate(chatId)}
          onClose={() => setSharing(false)}
        />
      )}
    </article>
  )
}

function Comments({ postId }: { postId: string }) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)

  const comments = useQuery({
    queryKey: postKeys.comments(postId),
    queryFn: () => fetchComments(postId),
  })

  const addMut = useMutation({
    mutationFn: () =>
      addCommentRequest(postId, { content: text.trim(), parentId: replyTo ?? undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.comments(postId) })
      void qc.invalidateQueries({ queryKey: postKeys.all })
      setText('')
      setReplyTo(null)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const delMut = useMutation({
    mutationFn: (commentId: string) => deleteCommentRequest(postId, commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postKeys.comments(postId) }),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const roots = (comments.data ?? []).filter((c) => c.parentId === null)
  const repliesOf = (id: string) => (comments.data ?? []).filter((c) => c.parentId === id)

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {comments.isLoading ? (
        <p className="text-xs text-muted-foreground">{t('loadingComments')}</p>
      ) : roots.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('noComments')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roots.map((c) => (
            <li key={c.id} className="flex flex-col gap-2">
              <CommentRow
                authorId={c.author.id}
                author={`${c.author.lastName} ${c.author.firstName}`}
                content={c.content}
                canDelete={c.author.id === myId}
                onReply={() => setReplyTo(c.id)}
                onDelete={() => delMut.mutate(c.id)}
              />
              {repliesOf(c.id).map((r) => (
                <div key={r.id} className="ml-6">
                  <CommentRow
                    authorId={r.author.id}
                    author={`${r.author.lastName} ${r.author.firstName}`}
                    content={r.content}
                    canDelete={r.author.id === myId}
                    onDelete={() => delMut.mutate(r.id)}
                  />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={replyTo ? t('replyPlaceholder') : t('commentPlaceholder')}
          className="h-9 flex-1 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        />
        {replyTo && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
            {t('cancelReply')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          icon
          aria-label={t('send')}
          loading={addMut.isPending}
          disabled={text.trim().length === 0}
          onClick={() => addMut.mutate()}
        >
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function CommentRow({
  authorId,
  author,
  content,
  canDelete,
  onReply,
  onDelete,
}: {
  authorId: string
  author: string
  content: string
  canDelete: boolean
  onReply?: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Feed')
  return (
    <div className="group rounded-xl bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <ProfileLink
          userId={authorId}
          className="text-xs font-semibold hover:text-primary hover:underline"
        >
          {author}
        </ProfileLink>
        <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="cursor-pointer text-xs text-primary hover:underline"
            >
              {t('reply')}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label={t('delete')}
              onClick={onDelete}
              className="cursor-pointer text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-sm whitespace-pre-wrap">{content}</p>
    </div>
  )
}
