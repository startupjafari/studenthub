import Image from 'next/image'
import { BookOpen } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

/** Обложка книги или заглушка с иконкой — в пропорциях книги (2:3). */
export function BookCover({
  url,
  title,
  className,
}: {
  url: string | null
  title: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative flex aspect-[2/3] w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      {url ? (
        <Image src={url} alt={title} fill unoptimized sizes="96px" className="object-cover" />
      ) : (
        <BookOpen className="size-1/2" aria-hidden />
      )}
    </span>
  )
}
