'use client'

import { cn } from '../../../shared/lib/utils'

// Пресеты градиент-обложек (ключ хранится в article.coverGradient).
export const ARTICLE_GRADIENTS: { key: string; className: string }[] = [
  { key: 'g1', className: 'bg-gradient-to-br from-primary to-indigo-500' },
  { key: 'g2', className: 'bg-gradient-to-br from-violet-500 to-fuchsia-500' },
  { key: 'g3', className: 'bg-gradient-to-br from-cyan-500 to-blue-600' },
  { key: 'g4', className: 'bg-gradient-to-br from-amber-500 to-rose-500' },
  { key: 'g5', className: 'bg-gradient-to-br from-emerald-500 to-teal-600' },
  { key: 'g6', className: 'bg-gradient-to-br from-slate-600 to-slate-900' },
  { key: 'g7', className: 'bg-gradient-to-br from-rose-500 to-pink-600' },
  { key: 'g8', className: 'bg-gradient-to-br from-yellow-400 to-orange-500' },
  { key: 'g9', className: 'bg-gradient-to-br from-lime-500 to-green-600' },
  { key: 'g10', className: 'bg-gradient-to-br from-sky-400 to-blue-600' },
  { key: 'g11', className: 'bg-gradient-to-br from-fuchsia-500 to-purple-700' },
  { key: 'g12', className: 'bg-gradient-to-br from-red-500 to-rose-700' },
  { key: 'g13', className: 'bg-gradient-to-br from-teal-400 to-cyan-600' },
  { key: 'g14', className: 'bg-gradient-to-br from-indigo-500 to-purple-600' },
  { key: 'g15', className: 'bg-gradient-to-br from-amber-400 to-pink-500' },
  { key: 'g16', className: 'bg-gradient-to-br from-green-400 to-emerald-600' },
  { key: 'g17', className: 'bg-gradient-to-br from-blue-500 to-violet-600' },
  { key: 'g18', className: 'bg-gradient-to-br from-stone-500 to-stone-800' },
]

const DEFAULT_GRADIENT = 'bg-gradient-to-br from-primary to-indigo-500'

function gradientClass(key: string): string {
  return ARTICLE_GRADIENTS.find((g) => g.key === key)?.className ?? DEFAULT_GRADIENT
}

// Авто-градиент по хэшу заголовка (стабильный выбор пресета).
function autoGradient(title: string): string {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return ARTICLE_GRADIENTS[h % ARTICLE_GRADIENTS.length]?.className ?? DEFAULT_GRADIENT
}

interface ArticleCoverProps {
  coverUrl?: string | null
  coverGradient?: string | null
  title: string
  className?: string
  // letter — компактная обложка-плейсхолдер (только первая буква заголовка, для мелких превью).
  letter?: boolean
}

// Обложка статьи: загруженное изображение, пресет-градиент или авто-обложка с заголовком.
export function ArticleCover({
  coverUrl,
  coverGradient,
  title,
  className,
  letter,
}: ArticleCoverProps) {
  if (coverUrl) {
    return <img src={coverUrl} alt="" className={cn('w-full object-cover', className)} />
  }
  const grad = coverGradient ? gradientClass(coverGradient) : autoGradient(title)
  return (
    <div className={cn('flex items-center justify-center p-2', grad, className)}>
      {letter ? (
        <span className="text-lg font-bold uppercase text-white drop-shadow-sm">
          {title.trim().charAt(0) || '—'}
        </span>
      ) : (
        <span className="line-clamp-3 text-center text-lg font-semibold text-white drop-shadow-sm">
          {title || '—'}
        </span>
      )}
    </div>
  )
}
