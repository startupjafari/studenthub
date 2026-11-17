package kz.studenthub.app.features.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing

/**
 * Текст сообщения с разметкой (PROJECT.md §3.6, разбор — `ChatMarkup`): строчное
 * оформление — `AnnotatedString`, цитата — полоской слева, блок кода — моноширинной
 * плашкой, список — маркерами.
 *
 * Спойлер до касания — прозрачный текст на подложке цвета текста (место в строке остаётся,
 * открытие не двигает раскладку); касание открывает все спойлеры сообщения, как в Telegram.
 * Ссылки внутри скрытого спойлера не нажимаются. Состояние — по [key] (id сообщения):
 * строка ленты, отданная другому сообщению, начинает со скрытых.
 */
@Composable
fun MessageMarkupText(content: String, key: String, isOwn: Boolean, textColor: Color, modifier: Modifier = Modifier) {
    val blocks = remember(content) { ChatMarkup.blocks(content) }
    var revealed by rememberSaveable(key) { mutableStateOf(false) }
    val accent = if (isOwn) textColor else AppTheme.colors.primary
    val reveal = { revealed = true }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = modifier) {
        blocks.forEach { block ->
            when (block) {
                is ChatMarkup.Block.Paragraph -> MarkupLine(block.inline, revealed, textColor, accent, reveal)
                is ChatMarkup.Block.Quote -> Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    modifier = Modifier.height(IntrinsicSize.Min),
                ) {
                    Box(Modifier.width(3.dp).fillMaxHeight().background(accent, RoundedCornerShape(2.dp)))
                    MarkupLine(block.inline, revealed, textColor.copy(alpha = 0.85f), accent, reveal)
                }
                is ChatMarkup.Block.Code -> Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier
                        .background(accent.copy(alpha = 0.12f), RoundedCornerShape(Radius.md))
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                ) {
                    block.language?.let { Text(it, style = AppType.meta, color = accent) }
                    Text(block.code, style = AppType.meta.copy(fontFamily = FontFamily.Monospace), color = textColor)
                }
                is ChatMarkup.Block.Bullets -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    block.items.forEach { item ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            Text(item.marker, style = AppType.tabular(AppType.body), color = textColor.copy(alpha = 0.8f))
                            MarkupLine(item.inline, revealed, textColor, accent, reveal)
                        }
                    }
                }
            }
        }
    }
}

/** Строка с разметкой; скрытый спойлер TalkBack читает словами «скрытый текст». */
@Composable
private fun MarkupLine(
    inline: ChatMarkup.Inline,
    revealed: Boolean,
    color: Color,
    accent: Color,
    onReveal: () -> Unit,
) {
    val hiddenLabel = stringResource(R.string.chats_spoiler_hidden)
    val revealLabel = stringResource(R.string.chats_spoiler_reveal)
    val annotated = remember(inline, revealed, color, accent, revealLabel) {
        annotate(inline, revealed, color, accent, revealLabel, onReveal)
    }
    val hidden = !revealed && inline.hasSpoiler
    Text(
        annotated,
        style = AppType.body,
        color = color,
        modifier = if (hidden) Modifier.semantics { contentDescription = inline.textWith { hiddenLabel } } else Modifier,
    )
}

/** Оформление строки: стили отрезков, ссылки и — пока не открыт — скрытый спойлер. */
private fun annotate(
    inline: ChatMarkup.Inline,
    revealed: Boolean,
    color: Color,
    accent: Color,
    revealLabel: String,
    onReveal: () -> Unit,
): AnnotatedString = buildAnnotatedString {
    append(inline.text)
    val hidden = if (revealed) emptyList() else inline.spans.filter { it.style == ChatMarkup.Style.Spoiler }
    fun insideHidden(span: ChatMarkup.Span) = hidden.any { span.start < it.end && it.start < span.end }
    for (span in inline.spans) {
        when (val style = span.style) {
            ChatMarkup.Style.Bold -> addStyle(SpanStyle(fontWeight = FontWeight.SemiBold), span.start, span.end)
            ChatMarkup.Style.Italic -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), span.start, span.end)
            ChatMarkup.Style.Underline -> addStyle(SpanStyle(textDecoration = TextDecoration.Underline), span.start, span.end)
            ChatMarkup.Style.Strike -> addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), span.start, span.end)
            ChatMarkup.Style.Code -> addStyle(
                SpanStyle(fontFamily = FontFamily.Monospace, background = color.copy(alpha = 0.12f)),
                span.start,
                span.end,
            )
            is ChatMarkup.Style.Link -> if (!insideHidden(span)) {
                addLink(
                    LinkAnnotation.Url(
                        style.url,
                        TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline)),
                    ),
                    span.start,
                    span.end,
                )
            }
            ChatMarkup.Style.Spoiler -> Unit
        }
    }
    // Спойлер — поверх остального: прозрачный текст гасит и цвет ссылки, и подчёркивание.
    for (span in hidden) {
        addStyle(SpanStyle(color = Color.Transparent, background = accent.copy(alpha = 0.28f)), span.start, span.end)
        addLink(LinkAnnotation.Clickable(revealLabel) { onReveal() }, span.start, span.end)
    }
}
