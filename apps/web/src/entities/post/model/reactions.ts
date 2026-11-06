import type { FeedPost, PostReactionSummary } from './types'

/** Реакция веба — «нравится». Остальные из белого списка (👍 🔥 …) ставят мобильные клиенты. */
export const LIKE_EMOJI = '❤️'

/**
 * Сводка реакций поста. API отдаёт её готовой (`reactionSummary`); у ответа старого API есть
 * только построчный `reactions` — тогда сворачиваем его сами.
 */
export function reactionSummaryOf(
  post: Pick<FeedPost, 'reactionSummary' | 'reactions'>,
  myId?: string | null,
): PostReactionSummary[] {
  if (post.reactionSummary) return post.reactionSummary
  const byEmoji = new Map<string, PostReactionSummary>()
  for (const row of post.reactions ?? []) {
    const item = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false }
    byEmoji.set(row.emoji, {
      ...item,
      count: item.count + 1,
      mine: item.mine || (!!myId && row.userId === myId),
    })
  }
  return [...byEmoji.values()]
}

/** Сколько реакций у поста всего — число у сердечка (все эмодзи, как и раньше). */
export function reactionTotal(summary: readonly PostReactionSummary[]): number {
  return summary.reduce((sum, item) => sum + item.count, 0)
}

/** Стоит ли среди реакций своя `emoji`. */
export function hasMyReaction(summary: readonly PostReactionSummary[], emoji: string): boolean {
  return summary.some((item) => item.emoji === emoji && item.mine)
}

/**
 * Сводка после того, как зритель поставил (`on`) или снял свою реакцию, — для оптимистичного
 * обновления до ответа сервера. Повтор того же состояния сводку не меняет: счётчик не уходит
 * ни в двойной плюс, ни ниже нуля.
 */
export function withMyReaction(
  summary: readonly PostReactionSummary[],
  emoji: string,
  on: boolean,
): PostReactionSummary[] {
  if (hasMyReaction(summary, emoji) === on) return [...summary]
  if (!summary.some((item) => item.emoji === emoji)) {
    return on ? [...summary, { emoji, count: 1, mine: true }] : [...summary]
  }
  return summary.flatMap((item) => {
    if (item.emoji !== emoji) return [item]
    const count = item.count + (on ? 1 : -1)
    return count > 0 ? [{ ...item, count, mine: on }] : []
  })
}
