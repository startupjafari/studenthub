'use client'

import { useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Ban,
  BarChart3,
  FileText,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Reply,
  Send,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import {
  VoiceWaveform,
  type ChatMemberInfo,
  type ChatMessage,
  type VoiceRecorderController,
} from '../../../entities/chat'
import { Avatar, AvatarFallback, Button, EmojiPicker } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Composer (Telegram-стиль §29, §37): панель правки/ответа, @-упоминания, вложения,
// запись голосового и поле ввода. Презентационный лист — состояние и мутации живут в родителе.
export type ChatComposerProps = {
  editing: ChatMessage | null
  onCancelEdit: () => void
  replyTo: ChatMessage | null
  replyToName: string
  onCancelReply: () => void
  // Личная блокировка активна: вместо поля ввода — баннер (нельзя писать).
  blocked: boolean
  // Я заблокировал собеседника (можно разблокировать) vs он меня.
  iBlocked: boolean
  otherId: string | undefined
  onUnblock: () => void
  text: string
  onType: (v: string) => void
  onSend: () => void
  showSend: boolean
  connected: boolean
  composerRef: RefObject<HTMLInputElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesPicked: (files: FileList | null) => void
  // Создать опрос (§38, attachment-меню). undefined — пункт не показываем (напр. в личных чатах).
  onCreatePoll?: () => void
  mentionCandidates: ChatMemberInfo[]
  onInsertMention: (u: ChatMemberInfo) => void
  onCloseMentions: () => void
  myId: string | undefined
  voice: VoiceRecorderController
  recMMSS: string
}

export function ChatComposer({
  editing,
  onCancelEdit,
  replyTo,
  replyToName,
  onCancelReply,
  blocked,
  iBlocked,
  otherId,
  onUnblock,
  text,
  onType,
  onSend,
  showSend,
  connected,
  composerRef,
  fileInputRef,
  onFilesPicked,
  onCreatePoll,
  mentionCandidates,
  onInsertMention,
  onCloseMentions,
  myId,
  voice,
  recMMSS,
}: ChatComposerProps) {
  const t = useTranslations('Chats')
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Вставка emoji из пикера (§12) в позицию курсора поля ввода.
  function insertEmoji(emoji: string): void {
    const el = composerRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    onType(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      if (el) {
        el.focus()
        const p = start + emoji.length
        el.setSelectionRange(p, p)
      }
    })
  }

  return (
    <>
      {/* Панель правки */}
      {editing && (
        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
          <Pencil className="size-3.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{t('editing')}</span>
            <p className="line-clamp-1 text-muted-foreground">{editing.content}</p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelEdit}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Панель ответа */}
      {replyTo && !editing && (
        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
          <Reply className="size-3.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{t('replyingTo', { name: replyToName })}</span>
            <p className="line-clamp-1 text-muted-foreground">
              {replyTo.content || t('attachment')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelReply}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {blocked ? (
        <div className="flex items-center justify-center gap-2 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-muted-foreground">
          <Ban className="size-4 shrink-0" aria-hidden />
          <span>{iBlocked ? t('blockedBanner') : t('blockedByBanner')}</span>
          {iBlocked && otherId && (
            <button
              type="button"
              onClick={onUnblock}
              className="font-medium text-primary hover:underline"
            >
              {t('unblockUser')}
            </button>
          )}
        </div>
      ) : (
        <div className="relative flex items-center gap-1.5 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {/* Попап @-упоминаний участников */}
          {mentionCandidates.length > 0 && !voice.recording && (
            <div className="absolute bottom-full left-3 z-20 mb-1 max-h-56 w-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
              {mentionCandidates.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onInsertMention(u)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className="text-xs">
                      {(u.lastName[0] ?? '') + (u.firstName[0] ?? '')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {u.lastName} {u.firstName}
                    {u.id === myId ? ` (${t('you')})` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
          {voice.recording ? (
            // Строка записи: отмена · таймер + волны · пауза/продолжить · отправить
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('cancelRecording')}
                onClick={voice.cancel}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-5" aria-hidden />
              </Button>
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-input px-3">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full bg-destructive',
                    !voice.paused && 'animate-pulse',
                  )}
                  aria-hidden
                />
                <span className="w-10 shrink-0 tabular-nums text-sm text-muted-foreground">
                  {recMMSS}
                </span>
                <VoiceWaveform analyserRef={voice.analyserRef} paused={voice.paused} />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={voice.paused ? t('resumeRecording') : t('pauseRecording')}
                onClick={voice.paused ? voice.resume : voice.pause}
              >
                {voice.paused ? (
                  <Play className="size-5" aria-hidden />
                ) : (
                  <Pause className="size-5" aria-hidden />
                )}
              </Button>
              <Button type="button" size="icon" aria-label={t('send')} onClick={voice.finish}>
                <Send className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('attach')}
                  disabled={!connected || !!editing}
                  onClick={() =>
                    onCreatePoll ? setAttachMenuOpen((v) => !v) : fileInputRef.current?.click()
                  }
                  className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Paperclip className="size-5" aria-hidden />
                </button>
                {/* Attachment-меню (§37): Файл / Опрос. Показываем, если доступно создание опроса. */}
                {attachMenuOpen && onCreatePoll && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAttachMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-50 mb-1 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-bottom-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAttachMenuOpen(false)
                          fileInputRef.current?.click()
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <FileText className="size-4 shrink-0 opacity-80" aria-hidden />
                        {t('attachFile')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachMenuOpen(false)
                          onCreatePoll()
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <BarChart3 className="size-4 shrink-0 opacity-80" aria-hidden />
                        {t('createPoll')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <input
                ref={composerRef}
                value={text}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  // Открыт попап упоминаний: Enter — выбрать первого, Escape — закрыть.
                  if (mentionCandidates.length > 0) {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const first = mentionCandidates[0]
                      if (first) onInsertMention(first)
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      onCloseMentions()
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
                placeholder={t('messagePlaceholder')}
                className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
              />
              {/* Emoji-пикер (§12): вставка в позицию курсора; попап остаётся открытым для нескольких. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('emoji')}
                  disabled={!connected}
                  onClick={() => setEmojiOpen((v) => !v)}
                  className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Smile className="size-5" aria-hidden />
                </button>
                {emojiOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setEmojiOpen(false)} />
                    <div className="absolute bottom-full right-0 z-50 mb-2">
                      <EmojiPicker searchPlaceholder={t('emojiSearch')} onPick={insertEmoji} />
                    </div>
                  </>
                )}
              </div>
              {showSend ? (
                <Button
                  type="button"
                  size="icon"
                  aria-label={t('send')}
                  disabled={!connected}
                  onClick={onSend}
                >
                  <Send className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('recordVoice')}
                  disabled={!connected}
                  onClick={() => void voice.start()}
                >
                  <Mic className="size-5" aria-hidden />
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
