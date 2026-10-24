package kz.studenthub.app.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/*
 * Строки списков: группа на карточке (как `insetGrouped` в iOS и списки настроек
 * Android), строка с ведущей иконкой и разделитель с отступом под иконку.
 */

/** Группа строк на карточке. */
@Composable
fun ListGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .background(AppTheme.colors.card, RoundedCornerShape(Radius.xl)),
    ) { content() }
}

/** Разделитель между строками группы: начинается после иконки, а не от края карточки. */
@Composable
fun ListDivider(inset: Boolean = true) {
    HorizontalDivider(color = AppTheme.colors.border, modifier = Modifier.padding(start = if (inset) 52.dp else 0.dp))
}

/** Строка-действие с ведущей иконкой. `tint` — для разрушающих действий вроде «Выйти». */
@Composable
fun ListRow(
    title: String,
    icon: ImageVector?,
    tint: Color? = null,
    subtitle: String? = null,
    trailing: @Composable RowScope.() -> Unit = {},
    onClick: (() -> Unit)? = null,
) {
    val colors = AppTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = ControlHeight.xl)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = Spacing.xl, vertical = Spacing.md),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = tint ?: colors.primary, modifier = Modifier.size(24.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = AppType.body, color = tint ?: colors.foreground)
            if (subtitle != null) Text(subtitle, style = AppType.meta, color = colors.mutedForeground)
        }
        trailing()
    }
}
