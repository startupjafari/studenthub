import { cn } from '../../../shared/lib/utils'

// Рендер текста сообщения в пределах контракта разметки чата (PROJECT.md §3.6 «Разметка
// сообщения чата»): жирный, курсив, моно, зачёркнутый, ссылка, цитата, блок кода, списки.
// Таблиц, заголовков и формул в чате нет — они остаются текстом (message-content-markdown).
export const MD_CLASS = cn(
  'message-md text-sm leading-relaxed break-words',
  '[&_p]:whitespace-pre-wrap [&_p]:m-0',
  '[&_p+p]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:list-disc [&_ol>li]:list-decimal',
  '[&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono',
  '[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/80 [&_pre]:p-2.5 [&_pre]:text-xs [&_pre]:text-white',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-white',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-current/40 [&_blockquote]:pl-2 [&_blockquote]:opacity-90',
)
