package kz.studenthub.app.designsystem

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/*
 * Контролы формы (DESIGN_SYSTEM §8 «Состояния», §10.3 «Форма»): кнопка действия,
 * тихая кнопка, рамка поля и две строки ошибки — ровно то, из чего собирается вход, и
 * то же, что в iOS-клиенте (`DesignSystem/Forms.swift`).
 */

/**
 * Главное действие формы. Загрузка — не `disabled`: заливка гаснет до `muted`, а
 * подпись сменяется индикатором, чтобы кнопка не выглядела сломанной.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isLoading: Boolean = false,
) {
    val colors = AppTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduceMotion = rememberReduceMotion()
    // §8: нажатие сдвигает кнопку на пиксель вниз — тот же отклик, что в вебе.
    val nudge by animateDpAsState(
        targetValue = if (pressed) 1.dp else 0.dp,
        animationSpec = Motion.respecting(Motion.calm(), reduceMotion),
        label = "press",
    )
    val shape = RoundedCornerShape(Radius.xl)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = ControlHeight.xl)
            .offset { IntOffset(0, nudge.roundToPx()) }
            .alpha(if (enabled || isLoading) 1f else 0.5f)
            .background(if (isLoading) colors.muted else colors.primary, shape)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled && !isLoading,
                role = Role.Button,
                onClick = onClick,
            )
            .padding(horizontal = Spacing.xl, vertical = Spacing.md),
    ) {
        Text(
            text = text,
            style = AppType.body.copy(fontWeight = AppType.cardTitle.fontWeight),
            color = colors.primaryForeground,
            modifier = Modifier.alpha(if (isLoading) 0f else 1f),
        )
        if (isLoading) {
            CircularProgressIndicator(
                color = colors.mutedForeground,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * Второстепенное действие: «Назад», «Отмена». Без заливки — чтобы в паре с главной
 * кнопкой было видно, какая основная.
 */
@Composable
fun QuietButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = AppTheme.colors.foreground,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(Radius.xl)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = ControlHeight.xl)
            .background(if (pressed) AppTheme.colors.muted else Color.Transparent, shape)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.xl, vertical = Spacing.md),
    ) {
        Text(text = text, style = AppType.body, color = color)
    }
}

/**
 * Поле ввода. Состояния ровно три: покой, фокус, ошибка — у каждого свой цвет рамки
 * плюс кольцо снаружи (§8). Ярлык над полем рисует `FieldLabel`, а `label` здесь —
 * для TalkBack: без него поле читается как «поле ввода», и вслепую не понять какое.
 */
@Composable
fun FormField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    isInvalid: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    textStyle: TextStyle = AppType.body,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = AppTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Radius.xl)
    val borderColor = when {
        isInvalid -> colors.destructive
        focused -> colors.ring
        else -> colors.border
    }
    val ringColor = when {
        isInvalid -> colors.destructive.copy(alpha = 0.15f)
        focused -> colors.ring.copy(alpha = 0.2f)
        else -> Color.Transparent
    }

    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = textStyle.copy(color = colors.foreground),
        cursorBrush = SolidColor(colors.primary),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        interactionSource = interaction,
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = label
                if (isInvalid) error(label)
            }
            // Кольцо лежит снаружи рамки, а не съедает её.
            .border(4.dp, ringColor, RoundedCornerShape(Radius.xl + 4.dp))
            .padding(4.dp)
            .background(colors.card, shape)
            .border(if (focused || isInvalid) 1.5.dp else 1.dp, borderColor, shape),
        decorationBox = { inner ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .defaultMinSize(minHeight = ControlHeight.xl)
                    .padding(horizontal = Spacing.lg),
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = textStyle, color = colors.mutedForeground)
                    }
                    inner()
                }
                if (trailing != null) {
                    Spacer(Modifier.width(Spacing.md))
                    trailing()
                }
            }
        },
    )
}

/** Подпись над полем (§10.3): ярлык, поле, ошибка — в этом порядке. */
@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = AppType.meta, color = AppTheme.colors.mutedForeground, modifier = modifier)
}

/** Ошибка под полем. Пустое значение не рисует ничего — ставится безусловно. */
@Composable
fun FieldError(message: String?) {
    if (message != null) {
        Text(
            message,
            style = AppType.meta,
            color = AppTheme.colors.destructive,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * Ошибка всей формы: нет связи, вход заблокирован, сессия протухла. Для ошибки поля
 * есть `FieldError` (§10.3).
 */
@Composable
fun FormAlert(message: String?, modifier: Modifier = Modifier) {
    if (message == null) return
    val colors = AppTheme.colors
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        modifier = modifier
            .fillMaxWidth()
            .background(colors.destructive.copy(alpha = 0.1f), RoundedCornerShape(Radius.xl))
            .padding(Spacing.lg),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = colors.destructive, modifier = Modifier.size(18.dp))
        Text(message, style = AppType.meta, color = colors.foreground, modifier = Modifier.weight(1f))
    }
}
