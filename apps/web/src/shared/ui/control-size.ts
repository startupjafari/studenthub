// Единая размерная шкала интерактивных контролов (§9 FRONTEND_RULES).
//
// Ровно четыре размера на компонент — sm/md/lg/xl — и одна и та же высота у всех
// контролов одного размера: кнопка, поле, селект, датапикер в одной строке (шапка
// страницы, тулбар, форма) выстраиваются по высоте без ручных классов. Ширину задаёт
// содержимое: у контролов нет фиксированной ширины, только высота и отступы.
//
// Высоты: sm 2rem · md 2.25rem · lg 2.5rem · xl 2.75rem.
// По умолчанию везде `lg` — он и есть «нормальный» размер интерфейса; `md` для плотных
// строк (шапки, тулбары), `sm` для строк таблиц и чипов, `xl` для крупных форм и
// первичных кнопок на пустых экранах.
export type ControlSize = 'sm' | 'md' | 'lg' | 'xl'

export const CONTROL_SIZES: ControlSize[] = ['sm', 'md', 'lg', 'xl']

// Контролы с содержимым в строку (кнопка, триггер меню): высота + отступы + размер иконки.
export const CONTROL_SIZE: Record<ControlSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
  md: "h-9 gap-2 px-3.5 text-sm [&_svg:not([class*='size-'])]:size-4",
  lg: "h-10 gap-2 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
  xl: "h-11 gap-2 px-5 text-base [&_svg:not([class*='size-'])]:size-4",
}

// Иконочные контролы: квадрат по высоте шкалы, без горизонтальных отступов.
export const CONTROL_SQUARE: Record<ControlSize, string> = {
  sm: "size-8 gap-0 px-0 [&_svg:not([class*='size-'])]:size-4",
  md: "size-9 gap-0 px-0 [&_svg:not([class*='size-'])]:size-4",
  lg: "size-10 gap-0 px-0 [&_svg:not([class*='size-'])]:size-4",
  xl: "size-11 gap-0 px-0 [&_svg:not([class*='size-'])]:size-5",
}

// Поля ввода и селекты: та же высота, но свои отступы и `text-base` на мобильном
// (иначе iOS зумит страницу при фокусе), сжимающийся до `text-sm` от md.
export const FIELD_SIZE: Record<ControlSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-3 text-sm',
  lg: 'h-10 px-3.5 text-base md:text-sm',
  xl: 'h-11 px-3.5 text-base md:text-sm',
}

// Многострочное поле: высота задаётся содержимым, шкала задаёт минимум.
export const AREA_SIZE: Record<ControlSize, string> = {
  sm: 'min-h-16 px-3 py-2 text-sm',
  md: 'min-h-20 px-3 py-2 text-sm',
  lg: 'min-h-24 px-3.5 py-2.5 text-base md:text-sm',
  xl: 'min-h-32 px-3.5 py-3 text-base md:text-sm',
}
