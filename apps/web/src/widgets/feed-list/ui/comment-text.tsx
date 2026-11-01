import type { ReactNode } from 'react'

// Голая ссылка и упоминание @логин (правила логина — как у профиля). Хвостовую пунктуацию
// не захватываем: «см. https://site.kz.» — точка не часть адреса.
const TOKEN_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(@[a-zA-Z0-9._-]{2,32})/g

/**
 * Текст комментария: переносы строк сохраняются, голые ссылки открываются в новой вкладке,
 * упоминания выделены. Разметку не разбираем — комментарий пишется как реплика, а не как
 * пост, и звёздочки в нём — это звёздочки. HTML не вставляется никогда: только React-узлы.
 */
export function CommentText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const [token, url] = match
    parts.push(
      url ? (
        <a
          key={index}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary break-all hover:underline"
        >
          {url}
        </a>
      ) : (
        <span key={index} className="text-primary">
          {token}
        </span>
      ),
    )
    last = index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
