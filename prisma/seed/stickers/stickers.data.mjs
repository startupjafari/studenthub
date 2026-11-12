// Набор «StudentHub»: фразы, эмодзи для поиска и цвета. Основной цвет — primary платформы
// (oklch(0.546 0.215 262.9) ≈ #2563eb), остальные — акценты для разнообразия в сетке.
// name — имя файла картинки, он же устойчивый ключ стикера при повторной заливке.

const BLUE = '#2563eb'
const GREEN = '#16a34a'
const ORANGE = '#ea580c'
const ROSE = '#e11d48'
const VIOLET = '#7c3aed'
const AMBER = '#f59e0b'
const TEAL = '#0d9488'
const SKY = '#0284c7'
const INK = '#1e293b'

export const STICKERS = [
  { name: 'privet', lines: ['Привет!'], emoji: '👋', color: BLUE },
  { name: 'spasibo', lines: ['Спасибо!'], emoji: '🙏', color: GREEN },
  { name: 'ok', lines: ['Ок'], emoji: '👌', color: SKY, shape: 'circle', fontSize: 150 },
  { name: 'gotovo', lines: ['Готово'], emoji: '✅', color: GREEN, shape: 'badge', check: true },
  { name: 'sdal', lines: ['Сдал!'], emoji: '🎉', color: VIOLET, shape: 'badge', fontSize: 104 },
  { name: 'sessiya', lines: ['Сессия'], emoji: '😱', color: ROSE, shape: 'badge' },
  { name: 'skoro-budu', lines: ['Скоро', 'буду'], emoji: '🏃', color: ORANGE, fontSize: 80 },
  { name: 'gde-para', lines: ['Где', 'пара?'], emoji: '🤔', color: BLUE, fontSize: 84 },
  { name: 'konspekt', lines: ['Конспект', 'есть?'], emoji: '📒', color: TEAL, fontSize: 68 },
  { name: 'udachi', lines: ['Удачи!'], emoji: '🍀', color: GREEN },
  {
    name: 'ura',
    lines: ['Ура!'],
    emoji: '🥳',
    color: AMBER,
    textColor: INK,
    shape: 'circle',
    fontSize: 110,
  },
  { name: 'ne-ponyal', lines: ['Не', 'понял'], emoji: '😕', color: VIOLET, fontSize: 84 },
  { name: 'pereryv', lines: ['Перерыв'], emoji: '☕', color: SKY, shape: 'badge', fontSize: 76 },
  { name: 'dedlayn', lines: ['Дедлайн'], emoji: '⏰', color: ROSE, shape: 'badge', fontSize: 76 },
  {
    name: 'pyaterka',
    lines: ['Пятёрка'],
    emoji: '⭐',
    color: AMBER,
    textColor: INK,
    shape: 'circle',
    fontSize: 76,
  },
  { name: 'poka', lines: ['Пока!'], emoji: '👋', color: ORANGE },
]
