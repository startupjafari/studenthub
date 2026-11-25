'use client'

import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Link2 } from 'lucide-react'
import { MarkdownImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { headingSlugsByLine, nodeText, slugify } from '../lib/article-toc'

/**
 * Типографика текста статьи — редакционная, как в Medium: строка 17px с интерлиньяжем
 * 1.75, абзацы через 20px, заголовки разделов без декоративных черт — иерархию задают
 * кегль и отбивки. Ширину колонки задаёт страница (680–760px), не текст.
 */
const PROSE = [
  'text-[1.0625rem] leading-[1.75] text-foreground [overflow-wrap:anywhere]',
  '[&_p]:my-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-primary',
  '[&_h1]:mt-12 [&_h1]:mb-4 [&_h1]:text-[1.75rem] [&_h1]:leading-tight [&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:leading-snug [&_h2]:font-bold [&_h2]:tracking-tight sm:[&_h2]:text-[1.625rem]',
  '[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:leading-snug [&_h3]:font-semibold',
  '[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold',
  '[&_h1]:scroll-mt-24 [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24',
  '[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li]:pl-1 [&_li>p]:my-1',
  '[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_blockquote]:italic',
  '[&_hr]:my-10 [&_hr]:border-border',
  '[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.875em]',
  '[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-relaxed',
  '[&_img]:mx-auto [&_img]:my-6 [&_img]:max-h-[36rem] [&_img]:rounded-xl',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[0.9375rem] [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2',
].join(' ')

/**
 * Текст статьи — один рендер на читалку и предпросмотр редактора: что автор видит в
 * предпросмотре, ровно то увидят читатели.
 *
 * Markdown разбирается в React-узлы (HTML из текста не вставляется: нет rehype-raw), ссылки
 * проходят стандартную очистку react-markdown (javascript: и прочие схемы отбрасываются),
 * чужие картинки показываются ссылкой (MarkdownImage). Заголовкам до третьего уровня —
 * уникальные якоря, те же, что в оглавлении (`headingSlugsByLine`). С `anchors` у заголовка
 * появляется кнопка «скопировать ссылку на раздел».
 */
export function ArticleContent({
  content,
  anchors = false,
  className,
}: {
  content: string
  anchors?: boolean
  className?: string
}) {
  const t = useTranslations('Article')
  const copied = t('sectionLinkCopied')
  const failed = t('copyFailed')
  const copyLabel = t('copySectionLink')

  // Компоненты — на текст, а не на каждый рендер: новый тип компонента перемонтировал бы
  // все заголовки при любой перерисовке страницы.
  const components = useMemo<Components>(() => {
    const slugs = headingSlugsByLine(content)
    const heading = (Tag: 'h1' | 'h2' | 'h3'): Components['h1'] =>
      function Heading({ node, children }) {
        const line = node?.position?.start.line
        const id = (line !== undefined && slugs.get(line)) || slugify(nodeText(children))
        return (
          <Tag id={id} className="group/heading relative">
            {children}
            {anchors && (
              <button
                type="button"
                aria-label={copyLabel}
                title={copyLabel}
                onClick={() => copySectionLink(id, copied, failed)}
                className="ml-2 inline-flex size-7 translate-y-[-0.1em] cursor-pointer items-center justify-center rounded-md align-middle text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/heading:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none max-md:hidden"
              >
                <Link2 className="size-4" aria-hidden />
              </button>
            )}
          </Tag>
        )
      }
    return {
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      img: MarkdownImage,
      // Широкая таблица прокручивается сама, а не растягивает страницу вбок.
      table: ({ children }) => (
        <div className="my-6 overflow-x-auto">
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        const external = typeof href === 'string' && /^https?:\/\//.test(href)
        return (
          <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {children}
          </a>
        )
      },
    }
  }, [content, anchors, copied, failed, copyLabel])

  return (
    <div className={cn(PROSE, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Ссылка на раздел — адрес страницы с якорем; адресная строка тоже переходит на раздел. */
export function copySectionLink(id: string, ok: string, failed: string): void {
  const url = `${window.location.origin}${window.location.pathname}#${encodeURIComponent(id)}`
  window.history.replaceState(window.history.state, '', `#${encodeURIComponent(id)}`)
  navigator.clipboard
    ?.writeText(url)
    .then(() => toast.success(ok))
    .catch(() => toast.error(failed))
}
