// Разбор текста сообщения на части, которые можно показать по-разному.
//
// В чатах платформы текст сообщения проходит через markdown (apps/web,
// entities/chat/ui/message-content.tsx): ссылка становится ссылкой, `код` — моноширинным,
// **жирное** — жирным. В мини-аппе тот же текст выводился как есть, и человек читал
// `<https://…>` вместе с угловыми скобками, `[сайт](адрес)` вместе со скобками и разметкой,
// а длинный адрес — сплошной строкой, по которой нечем нажать.
//
// Своим разбором, а не библиотекой: у мини-аппа нет ни одной зависимости, и тащить
// markdown-движок ради четырёх правил значило бы удвоить его вес. Поддерживается ровно то,
// что встречается в переписке поддержки, — остальное остаётся текстом и ничего не ломает.
//
// Разбор ПЛОСКИЙ: жирное внутри ссылки не разбирается. В переписке такого не пишут, а
// вложенность стоила бы рекурсивного разбора и отдельного набора ошибок.

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }

/**
 * Одно правило на все виды разметки: чередование разбирается слева направо, и на равной
 * позиции выигрывает то, что записано раньше, — поэтому ссылки идут перед выделением, а
 * `**жирное**` перед `*наклонным*`.
 *
 * Схема у адреса обязательна (`http://`, `https://`) либо это `www.` — иначе в ссылку
 * превращались бы «файл.docx» и «вер.2», которых в переписке больше, чем адресов.
 *
 * Выделение не начинается с пробела (`[^\s*]`) — иначе «5 * 3 * 2» читалось бы как
 * наклонный текст. Без обратных просмотров (`lookbehind`): их нет в WebView старых
 * iPhone, и выражение падало бы при разборе файла, то есть приложение не запускалось бы
 * вовсе.
 */
const PATTERN = new RegExp(
  [
    // [текст](адрес)
    String.raw`\[(?<linkText>[^\]\n]+)\]\((?<linkHref>(?:https?:\/\/|www\.)[^\s)]+)\)`,
    // <адрес> — угловые скобки markdown, показывать их не нужно
    String.raw`<(?<autoHref>(?:https?:\/\/|www\.)[^\s<>]+)>`,
    // голый адрес в тексте
    String.raw`(?<bareHref>(?:https?:\/\/|www\.)[^\s<>]+)`,
    String.raw`\`(?<code>[^\`\n]+)\``,
    String.raw`\*\*(?<bold>[^\s*][^*\n]*?)\*\*`,
    String.raw`\*(?<italic>[^\s*][^*\n]*?)\*`,
  ].join('|'),
  'g',
)

/** Знаки, которые в конце голого адреса принадлежат предложению, а не ссылке. */
const TAIL = '.,!?;:«»"’”'

/**
 * Отрезать от адреса хвост предложения.
 *
 * «Смотри https://studenthub.kz.» — точка здесь конец фразы, а не часть адреса, и
 * открытая с ней ссылка ведёт в никуда. Закрывающая скобка отрезается только лишняя:
 * в адресах Википедии она часть пути.
 */
function trimTail(url: string): string {
  let end = url.length
  while (end > 0) {
    const char = url[end - 1] as string
    if (TAIL.includes(char)) {
      end -= 1
      continue
    }
    if (char === ')') {
      const head = url.slice(0, end)
      const opened = (head.match(/\(/g) ?? []).length
      const closed = (head.match(/\)/g) ?? []).length
      if (closed > opened) {
        end -= 1
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

/** Адрес без схемы браузер считает относительным путём: `www.x.kz` увёл бы на сам мини-апп. */
function href(url: string): string {
  return url.startsWith('www.') ? `https://${url}` : url
}

/**
 * Текст сообщения → части для отрисовки. Всё, что не разобрано, остаётся текстом:
 * сообщение никогда не теряет ни символа, даже если разметка в нём битая.
 */
export function parseMessage(content: string): Token[] {
  const tokens: Token[] = []
  let at = 0

  const plain = (text: string): void => {
    if (text.length === 0) return
    const last = tokens.at(-1)
    // Склеиваем соседний текст: хвост, отрезанный от адреса, иначе стал бы отдельной
    // частью и на отрисовке получил бы свой узел.
    if (last?.kind === 'text') last.text += text
    else tokens.push({ kind: 'text', text })
  }

  for (const match of content.matchAll(PATTERN)) {
    const groups = match.groups ?? {}
    const start = match.index
    plain(content.slice(at, start))
    at = start + match[0].length

    if (groups.linkHref !== undefined && groups.linkText !== undefined) {
      tokens.push({ kind: 'link', text: groups.linkText, href: href(groups.linkHref) })
      continue
    }
    const url = groups.autoHref ?? groups.bareHref
    if (url !== undefined) {
      const visible = trimTail(url)
      // Адрес из одной схемы («https://») ссылкой не делаем: вести ей некуда.
      if (visible.length === 0 || /^(?:https?:\/\/|www\.)$/.test(visible)) {
        plain(match[0])
        continue
      }
      // Угловые скобки markdown сам показывать не должен, а отрезанный хвост — должен.
      if (groups.autoHref !== undefined) plain('')
      tokens.push({ kind: 'link', text: visible, href: href(visible) })
      plain(url.slice(visible.length))
      continue
    }
    if (groups.code !== undefined) tokens.push({ kind: 'code', text: groups.code })
    else if (groups.bold !== undefined) tokens.push({ kind: 'bold', text: groups.bold })
    else if (groups.italic !== undefined) tokens.push({ kind: 'italic', text: groups.italic })
  }

  plain(content.slice(at))
  return tokens
}
