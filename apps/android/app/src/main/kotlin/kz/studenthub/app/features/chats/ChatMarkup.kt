package kz.studenthub.app.features.chats

/**
 * Разметка текста сообщения — контракт PROJECT.md §3.6, тот же, что рисуют веб и iOS:
 * жирный (`**`, `__`), курсив (`*`, `_`), подчёркнутый (`++`), зачёркнутый (`~~`), моно
 * (`` ` ``), спойлер (`||`), ссылка (`[текст](url)`, `<url>`, голый `https://…`), цитата
 * (`> `), блок кода (```` ``` ```` с языком), списки (`- `, `* `, `1. `). Прочее —
 * исходным текстом.
 *
 * Своим разбором, а не библиотекой Markdown: нужен ровно этот набор, а всё сверх него
 * обязано остаться буквами (клиент не рисует того, чего не рисуют другие). Разбор чистый —
 * без Android и Compose, его проверяют юнит-тесты; отрисовка — `MessageMarkupText`.
 *
 * Правила `++` и `||` — общие для всех клиентов (`shared/lib/chat-markup.ts` у веба,
 * `ChatMarkup.swift` у iOS): маркер — ровно два знака; открывающий — не после буквы или
 * цифры и не перед пробелом; закрывающий — не после пробела и не перед буквой или цифрой.
 * Так `i++; j++`, `C++ и C++`, `a || b`, `a||b||c` остаются текстом.
 */
object ChatMarkup {
    sealed interface Style {
        data object Bold : Style
        data object Italic : Style
        data object Underline : Style
        data object Strike : Style
        data object Code : Style
        data object Spoiler : Style
        data class Link(val url: String) : Style
    }

    /** Отрезок `[start, end)` разобранного текста со своим оформлением. */
    data class Span(val start: Int, val end: Int, val style: Style)

    /** Строчный текст без разметки и оформление его отрезков. */
    data class Inline(val text: String, val spans: List<Span>) {
        val hasSpoiler: Boolean get() = spans.any { it.style == Style.Spoiler }

        /** Текст, где каждый спойлер заменён тем, что вернёт [spoiler] (его видимый текст на входе). */
        fun textWith(spoiler: (String) -> String): String {
            val hidden = spans.filter { it.style == Style.Spoiler }.sortedBy { it.start }
            if (hidden.isEmpty()) return text
            val out = StringBuilder()
            var at = 0
            for (span in hidden) {
                if (span.start < at) continue
                out.append(text, at, span.start).append(spoiler(text.substring(span.start, span.end)))
                at = span.end
            }
            return out.append(text, at, text.length).toString()
        }
    }

    sealed interface Block {
        data class Paragraph(val inline: Inline) : Block
        data class Quote(val inline: Inline) : Block
        data class Code(val language: String?, val code: String) : Block
        data class Bullets(val items: List<Item>) : Block
    }

    /** Пункт списка: «•» или номер с точкой и текст. */
    data class Item(val marker: String, val inline: Inline)

    private const val FENCE = "```"
    private const val PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    private val LIST_MARKER = Regex("""^(?:[-*] |(\d{1,3})\. )""")
    private val LANGUAGE = Regex("""^[\p{L}\p{N}+#._-]{1,24}$""")
    private val BARE_URL = Regex("""^(?:https?://|www\.)[^\s<>]+""", RegexOption.IGNORE_CASE)
    private val ANGLE_URL = Regex("""^<(https?://[^\s<>]+)>""", RegexOption.IGNORE_CASE)
    private val SAFE_SCHEMES = listOf("http://", "https://", "mailto:")
    private const val URL_TAIL = ".,:;!?\"'»”’"

    /** Есть ли что открывать касанием. */
    fun hasSpoiler(source: String): Boolean =
        source.contains("||") && blocks(source).any { block ->
            when (block) {
                is Block.Paragraph -> block.inline.hasSpoiler
                is Block.Quote -> block.inline.hasSpoiler
                is Block.Bullets -> block.items.any { it.inline.hasSpoiler }
                is Block.Code -> false
            }
        }

    /**
     * Однострочное превью (список чатов, цитата ответа): без разметки, блок кода — словом
     * [code], спойлер — знаками Брайля той же длины, как в Telegram и других клиентах.
     */
    fun preview(source: String, code: String): String =
        blocks(source).joinToString(" ") { block ->
            when (block) {
                is Block.Paragraph -> block.inline.textWith(::placeholder)
                is Block.Quote -> block.inline.textWith(::placeholder)
                is Block.Code -> code
                is Block.Bullets -> block.items.joinToString(" ") { "${it.marker} " + it.inline.textWith(::placeholder) }
            }
        }.replace(Regex("""\s+"""), " ").trim()

    /** Спойлер в превью: `⠿` той же длины, не больше 12. */
    fun placeholder(visible: String): String = "⠿".repeat(visible.trim().length.coerceIn(1, 12))

    // MARK: Блоки

    fun blocks(source: String): List<Block> {
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val blocks = mutableListOf<Block>()
        val paragraph = mutableListOf<String>()
        val quote = mutableListOf<String>()
        val items = mutableListOf<Item>()

        fun flushParagraph() {
            val text = paragraph.joinToString("\n").trim('\n')
            if (text.isNotBlank()) blocks += Block.Paragraph(inline(text))
            paragraph.clear()
        }
        fun flushQuote() {
            val text = quote.joinToString("\n").trim('\n')
            if (text.isNotBlank()) blocks += Block.Quote(inline(text))
            quote.clear()
        }
        fun flushList() {
            if (items.isNotEmpty()) blocks += Block.Bullets(items.toList())
            items.clear()
        }
        fun flushAll() {
            flushParagraph()
            flushQuote()
            flushList()
        }

        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            if (line.startsWith(FENCE)) {
                val close = (i + 1 until lines.size).firstOrNull { lines[it].trim() == FENCE }
                if (close != null) {
                    flushAll()
                    val head = line.removePrefix(FENCE).trim()
                    val code = lines.subList(i + 1, close).joinToString("\n")
                    if (code.isNotBlank()) {
                        blocks += Block.Code(head.takeIf { LANGUAGE.matches(it) }?.lowercase(), code)
                    }
                    i = close + 1
                    continue
                }
            }
            val marker = LIST_MARKER.find(line)
            when {
                line.startsWith(">") -> {
                    flushParagraph()
                    flushList()
                    val body = line.trimStart('>')
                    quote += if (body.startsWith(" ")) body.substring(1) else body
                }
                marker != null -> {
                    flushParagraph()
                    flushQuote()
                    val number = marker.groupValues[1]
                    items += Item(if (number.isEmpty()) "•" else "$number.", inline(line.substring(marker.value.length)))
                }
                line.isBlank() -> flushAll()
                else -> {
                    flushQuote()
                    flushList()
                    paragraph += line
                }
            }
            i++
        }
        flushAll()
        return blocks
    }

    // MARK: Строчная разметка

    fun inline(source: String): Inline {
        val out = StringBuilder()
        val spans = mutableListOf<Span>()
        parse(source, 0, source.length, out, spans)
        return Inline(out.toString(), spans)
    }

    private fun parse(s: String, from: Int, to: Int, out: StringBuilder, spans: MutableList<Span>) {
        var i = from
        while (i < to) {
            val c = s[i]
            if (c == '\\' && i + 1 < to && s[i + 1] in PUNCT) {
                out.append(s[i + 1])
                i += 2
                continue
            }
            if (c == '`') {
                val fence = runLength(s, i, to)
                val end = codeSpanEnd(s, i, to)
                if (end == -1) {
                    out.append(s, i, i + fence)
                    i += fence
                    continue
                }
                var code = s.substring(i + fence, end - fence)
                if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.isNotBlank()) {
                    code = code.substring(1, code.length - 1)
                }
                val start = out.length
                out.append(code)
                spans += Span(start, out.length, Style.Code)
                i = end
                continue
            }
            if (c == '!' && i + 1 < to && s[i + 1] == '[') {
                // Картинка вне контракта — исходным текстом, а не ссылкой (как на вебе).
                val link = linkAt(s, i + 1, to)
                if (link != null) {
                    out.append(s, i, link.end)
                    i = link.end
                    continue
                }
            }
            if (c == '[') {
                val link = linkAt(s, i, to)
                if (link != null) {
                    val start = out.length
                    parse(s, link.labelStart, link.labelEnd, out, spans)
                    if (SAFE_SCHEMES.any { link.url.startsWith(it, ignoreCase = true) }) {
                        spans += Span(start, out.length, Style.Link(link.url))
                    }
                    i = link.end
                    continue
                }
            }
            if (c == '<') {
                val match = ANGLE_URL.find(s.substring(i, to))
                if (match != null) {
                    val url = match.groupValues[1]
                    val start = out.length
                    out.append(url)
                    spans += Span(start, out.length, Style.Link(url))
                    i += match.value.length
                    continue
                }
            }
            if ((c == 'h' || c == 'H' || c == 'w' || c == 'W') && (i == from || !s[i - 1].isLetterOrDigit())) {
                val match = BARE_URL.find(s.substring(i, to))
                if (match != null) {
                    val url = trimUrl(match.value)
                    val www = url.startsWith("www.", ignoreCase = true)
                    if (if (www) url.length > 4 else url.substringAfter("://").isNotEmpty()) {
                        val start = out.length
                        out.append(url)
                        spans += Span(start, out.length, Style.Link(if (www) "https://$url" else url))
                        i += url.length
                        continue
                    }
                }
            }
            val delimiter = delimiterAt(s, i, from, to)
            if (delimiter != null) {
                val close = closingAt(s, i, to, delimiter)
                if (close != -1) {
                    val start = out.length
                    parse(s, i + delimiter.length, close, out, spans)
                    if (out.length > start) spans += Span(start, out.length, styleOf(delimiter))
                    i = close + delimiter.length
                    continue
                }
                out.append(delimiter)
                i += delimiter.length
                continue
            }
            out.append(c)
            i++
        }
    }

    private class LinkMatch(val labelStart: Int, val labelEnd: Int, val url: String, val end: Int)

    /** `[подпись](адрес)` с `[` в [at]: скобки подписи парные, адрес без пробелов. */
    private fun linkAt(s: String, at: Int, to: Int): LinkMatch? {
        var depth = 0
        var i = at
        var labelEnd = -1
        while (i < to) {
            when (s[i]) {
                '\\' -> i++
                '`' -> {
                    val end = codeSpanEnd(s, i, to)
                    if (end != -1) i = end - 1
                }
                '[' -> depth++
                ']' -> {
                    depth--
                    if (depth == 0) {
                        labelEnd = i
                        break
                    }
                }
                '\n' -> if (i + 1 < to && s[i + 1] == '\n') return null
            }
            i++
        }
        if (labelEnd == -1 || labelEnd + 1 >= to || s[labelEnd + 1] != '(') return null
        var j = labelEnd + 2
        var parens = 0
        while (j < to) {
            val ch = s[j]
            if (ch.isWhitespace()) return null
            if (ch == '(') parens++
            if (ch == ')') {
                if (parens == 0) break
                parens--
            }
            j++
        }
        if (j >= to) return null
        val url = s.substring(labelEnd + 2, j)
        if (url.isEmpty()) return null
        return LinkMatch(at + 1, labelEnd, url, j + 1)
    }

    /** Хвост предложения и маркер спойлера адресу не принадлежат. */
    private fun trimUrl(raw: String): String {
        var url = raw.substringBefore("||")
        while (url.isNotEmpty()) {
            val last = url.last()
            url = when {
                last in URL_TAIL || last == '*' || last == '_' || last == '~' -> url.dropLast(1)
                last == ')' && url.count { it == ')' } > url.count { it == '(' } -> url.dropLast(1)
                else -> return url
            }
        }
        return url
    }

    private fun styleOf(delimiter: String): Style = when (delimiter) {
        "**", "__" -> Style.Bold
        "*", "_" -> Style.Italic
        "~~" -> Style.Strike
        "++" -> Style.Underline
        else -> Style.Spoiler
    }

    private fun isWord(c: Char?): Boolean = c != null && c.isLetterOrDigit()

    private fun runLength(s: String, at: Int, to: Int): Int {
        var end = at
        while (end < to && s[end] == s[at]) end++
        return end - at
    }

    private fun isEscaped(s: String, at: Int, from: Int): Boolean {
        var slashes = 0
        var i = at - 1
        while (i >= from && s[i] == '\\') {
            slashes++
            i--
        }
        return slashes % 2 == 1
    }

    /** Конец строчного кода с серии `` ` `` в [at] — после закрывающей серии той же длины, или -1. */
    private fun codeSpanEnd(s: String, at: Int, to: Int): Int {
        val fence = runLength(s, at, to)
        var i = at + fence
        while (i < to) {
            if (s[i] == '`') {
                val run = runLength(s, i, to)
                if (run == fence) return i + run
                i += run
            } else {
                i++
            }
        }
        return -1
    }

    /**
     * Открывающий разделитель в [at]: серия знака ровно нужной длины. `++`/`||` и `_` —
     * не внутри слова; у всех после открывающего — не пробел.
     */
    private fun delimiterAt(s: String, at: Int, from: Int, to: Int): String? {
        val c = s[at]
        if (c !in "*_~+|" || isEscaped(s, at, from)) return null
        // Середина серии (`|||`, `++++`) — не разделитель: серию меряем от её начала.
        if (at > from && s[at - 1] == c) return null
        val run = runLength(s, at, to)
        val delimiter = when {
            c == '*' || c == '_' -> if (run == 1 || run == 2) c.toString().repeat(run) else return null
            run == 2 -> "$c$c"
            else -> return null
        }
        val prev = if (at > from) s[at - 1] else null
        val next = if (at + delimiter.length < to) s[at + delimiter.length] else null
        if (next == null || next.isWhitespace()) return null
        if (c != '*' && c != '~' && isWord(prev)) return null
        return delimiter
    }

    /** Закрывающий разделитель для открывающего в [open] — ближайший подходящий, или -1. */
    private fun closingAt(s: String, open: Int, to: Int, delimiter: String): Int {
        val c = delimiter[0]
        var i = open + delimiter.length
        while (i < to) {
            val ch = s[i]
            if (ch == '\\') {
                i += 2
                continue
            }
            if (ch == '\n' && i + 1 < to && s.substring(i + 1).trimStart(' ', '\t').startsWith('\n')) return -1
            if (ch == '`') {
                val end = codeSpanEnd(s, i, to)
                i = if (end == -1) i + runLength(s, i, to) else end
                continue
            }
            if (ch == c) {
                val run = runLength(s, i, to)
                if (run == delimiter.length && i > open + delimiter.length) {
                    val prev = s[i - 1]
                    val next = if (i + run < to) s[i + run] else null
                    val boundary = c == '*' || c == '~' || !isWord(next)
                    if (!prev.isWhitespace() && boundary) return i
                }
                i += run
                continue
            }
            i++
        }
        return -1
    }
}
