package kz.studenthub.app.designsystem

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Отступы (DESIGN_SYSTEM §4). База — 4, лестница 1 · 1.5 · 2 · 3 · 4 · 6.
 * Промежуточных значений нет: нужен зазор между `lg` и `xl` — неверно выбран один из них.
 */
object Spacing {
    val xs = 4.dp
    val sm = 6.dp
    val md = 8.dp
    val lg = 12.dp
    val xl = 16.dp
    val xxl = 24.dp
}

/**
 * Высота контролов (DESIGN_SYSTEM §4). Четыре размера: одинаковый размер — одинаковая
 * высота у кнопки, поля и селекта. `xl` на Android — 48: это минимальная цель касания
 * Material, и меньше неё кнопка формы не бывает (в iOS — 44 по HIG).
 */
object ControlHeight {
    val sm = 32.dp
    val md = 36.dp
    val lg = 40.dp
    val xl = 48.dp

    /** Плавающие острова у нижнего края: нижняя навигация, её меню и поиск. */
    val island = 56.dp

    /** Панель ввода чата: в открытом чате нижней навигации нет, совпадать не с чем. */
    val chatInput = 48.dp
}

/**
 * Радиусы (DESIGN_SYSTEM §5.1). Шкала считается от корня: форма системы задаётся
 * одним числом, производные по отдельности не меняются.
 */
object Radius {
    /** `--radius: 0.625rem`. */
    val root = 10.dp

    /** Мелкое: чекбокс, скелетон. */
    val sm = root * 0.6f

    /** Вложенное в контрол: активная вкладка, квадрат ведущей иконки, пункт меню. */
    val md = root * 0.8f
    val lg = root

    /** Контролы и поверхности: кнопка, поле, карточка, поповер. */
    val xl = root * 1.4f

    /** Модалка и нижний лист. */
    val xxl = root * 1.8f
    val xxxl = root * 2.2f

    /** Внутренний элемент скругляется на ступень меньше внешнего — иначе угол «съеден». */
    fun nested(outer: Dp): Dp = maxOf(outer - 4.dp, sm)
}
