package kz.studenthub.app.features

import kz.studenthub.app.features.chats.ChatMarkup
import kz.studenthub.app.features.chats.ChatMarkup.Block
import kz.studenthub.app.features.chats.ChatMarkup.Style
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Разметка сообщения (PROJECT.md §3.6): те же случаи, что у веба
 * (`shared/lib/chat-markup.test.ts`) и iOS (`ChatMarkupTests.swift`).
 */
class ChatMarkupTest {
    /** Текст отрезков данного стиля. */
    private fun ChatMarkup.Inline.styled(style: Style): List<String> =
        spans.filter { it.style == style }.map { text.substring(it.start, it.end) }

    @Test
    fun underlineAndSpoiler() {
        val inline = ChatMarkup.inline("это ++важно++, ответ ||42||")
        assertEquals("это важно, ответ 42", inline.text)
        assertEquals(listOf("важно"), inline.styled(Style.Underline))
        assertEquals(listOf("42"), inline.styled(Style.Spoiler))
    }

    @Test
    fun markupInsideSpoiler() {
        val inline = ChatMarkup.inline("||**жир** и ++под++||")
        assertEquals("жир и под", inline.text)
        assertEquals(listOf("жир и под"), inline.styled(Style.Spoiler))
        assertEquals(listOf("жир"), inline.styled(Style.Bold))
        assertEquals(listOf("под"), inline.styled(Style.Underline))
    }

    /** Код и выражения, где такие знаки встречались до 17.11.2026, остаются текстом. */
    @Test
    fun codeAndExpressionsStayText() {
        for (text in listOf("i++; j++", "C++ и C++", "a || b || c", "a||b||c", "|||a|||", "++++")) {
            val inline = ChatMarkup.inline(text)
            assertEquals(text, text, inline.text)
            assertTrue(text, inline.spans.isEmpty())
        }
    }

    @Test
    fun escapesAndInlineCode() {
        assertEquals("||a||", ChatMarkup.inline("\\|\\|a\\|\\|").text)
        val inline = ChatMarkup.inline("`||код||` и ||b||")
        assertEquals("||код|| и b", inline.text)
        assertEquals(listOf("||код||"), inline.styled(Style.Code))
        assertEquals(listOf("b"), inline.styled(Style.Spoiler))
    }

    /** Остальной контракт: прежняя разметка, `__` — жирный, как на вебе и iOS. */
    @Test
    fun basicContract() {
        val inline = ChatMarkup.inline("**ж** __ж2__ *к* _к2_ ~~з~~ `м` [сайт](https://x.kz) https://y.kz.")
        assertEquals("ж ж2 к к2 з м сайт https://y.kz.", inline.text)
        assertEquals(listOf("ж", "ж2"), inline.styled(Style.Bold))
        assertEquals(listOf("к", "к2"), inline.styled(Style.Italic))
        assertEquals(listOf("з"), inline.styled(Style.Strike))
        val links = inline.spans.mapNotNull { it.style as? Style.Link }.map { it.url }
        assertEquals(listOf("https://x.kz", "https://y.kz"), links)
    }

    @Test
    fun spoilerAroundBareUrl() {
        val inline = ChatMarkup.inline("||https://x.kz||")
        assertEquals("https://x.kz", inline.text)
        assertEquals(listOf("https://x.kz"), inline.spans.mapNotNull { it.style as? Style.Link }.map { it.url })
    }

    @Test
    fun outOfContractStaysText() {
        assertEquals("# заголовок", ChatMarkup.inline("# заголовок").text)
        assertEquals("![кот](https://x.kz/c.png)", ChatMarkup.inline("![кот](https://x.kz/c.png)").text)
        assertEquals("5 * 3 * 2", ChatMarkup.inline("5 * 3 * 2").text)
        assertEquals("snake_case_name", ChatMarkup.inline("snake_case_name").text)
    }

    @Test
    fun blocks() {
        val blocks = ChatMarkup.blocks("текст\n> цитата ||с||\n\n```kotlin\nval a = 1\n```\n- раз\n2. два")
        assertEquals(4, blocks.size)
        assertEquals("текст", (blocks[0] as Block.Paragraph).inline.text)
        assertEquals("цитата с", (blocks[1] as Block.Quote).inline.text)
        assertEquals(Block.Code("kotlin", "val a = 1"), blocks[2])
        assertEquals(listOf("•", "2."), (blocks[3] as Block.Bullets).items.map { it.marker })
    }

    @Test
    fun previewHidesSpoiler() {
        assertEquals("важно ответ: ⠿⠿", ChatMarkup.preview("++важно++ ответ: ||42||", code = "Код"))
        assertFalse(ChatMarkup.preview("||**секрет**||", code = "Код").contains("секрет"))
        assertEquals("Смотри: Код вот", ChatMarkup.preview("Смотри:\n```\nlet a = 1\n```\nвот", code = "Код"))
        assertEquals("⠿".repeat(12), ChatMarkup.placeholder("x".repeat(40)))
    }

    @Test
    fun hasSpoiler() {
        assertTrue(ChatMarkup.hasSpoiler("ответ ||42||"))
        assertFalse(ChatMarkup.hasSpoiler("a || b"))
        assertFalse(ChatMarkup.hasSpoiler("```\n||в коде||\n```"))
    }
}
