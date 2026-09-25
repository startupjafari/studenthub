import {
  BookOpen,
  Building2,
  Church,
  Flag,
  Flame,
  Flower2,
  Ghost,
  GraduationCap,
  Heart,
  HeartHandshake,
  Landmark,
  Languages,
  Moon,
  MoonStar,
  PartyPopper,
  Scale,
  School,
  Shield,
  Sparkles,
  Star,
  Sun,
  TreePine,
  type LucideIcon,
} from 'lucide-react'

/**
 * Иконка праздника.
 *
 * Смысл слота при этом не меняется: и в поздравлении, и в календаре иконка говорит одно и
 * то же — «этот день особенный». Меняется только глиф, и меняется он вместе с датой, как
 * и цвет. Поэтому карта живёт здесь, а не в разметке экранов: праздник нигде не
 * перечисляется условиями, у него просто спрашивают иконку.
 *
 * Сдержанные даты иконку ТОЖЕ получают, в отличие от палитры. Церковь на Рождество и
 * звезда на 9 мая — не украшение, а точный знак дня; отсутствие иконки там, где у всех
 * остальных она есть, читалось бы как недоделка, а не как такт.
 *
 * Набор один — lucide (§6): эмодзи и свои SVG в этой системе не используются, включая
 * праздники. Иконок здесь два десятка, и каждая тянется из lucide поштучно — это
 * единицы килобайт, а не набор целиком.
 */
export const SEASON_ICON: Record<string, LucideIcon> = {
  // Зима: хлопушка самому празднику, ёлка — его кануну.
  'new-year': PartyPopper,
  'new-year-eve': TreePine,
  'orthodox-christmas': Church,

  // Весна: Наурыз — приход весны и равноденствие, отсюда солнце.
  'womens-day': Flower2,
  nauryz: Sun,
  'oraza-ait': Moon,

  // Государственные даты: у каждой свой знак, иначе пять флагов подряд ничего не различают.
  'unity-day': HeartHandshake,
  'defender-day': Shield,
  'victory-day': Star,
  'kurban-ait': MoonStar,
  'capital-day': Building2,
  'constitution-day': Scale,
  'republic-day': Landmark,
  'independence-day': Flag,

  // Учебные.
  'knowledge-day': BookOpen,
  'teachers-day': School,
  'languages-day': Languages,
  'students-day': GraduationCap,

  // День памяти: свеча, а не символ праздника. В календаре он показывается, и знак дня
  // нужен ему не меньше остальных — но другой по тону.
  'repression-victims-day': Flame,

  // Выключенные мягкие даты: иконки заведены заранее, чтобы включение оставалось
  // сменой флага, а не правкой ещё одного файла.
  'valentines-day': Heart,
  halloween: Ghost,
}

/** Иконка праздника; `Sparkles` — на случай даты, которой ещё не подобрали свою. */
export function seasonIcon(id: string): LucideIcon {
  return SEASON_ICON[id] ?? Sparkles
}
