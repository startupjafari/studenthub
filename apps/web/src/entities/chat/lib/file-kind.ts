// Тип документа по его расширению: короткая подпись на значке и цвет под неё (§7 карты).
//
// Цвет здесь — не украшение: в списке из двух десятков вложений он единственное, что
// различает архив, таблицу и картинку до чтения имени. Группы взяты по тому, как файлы
// используются, а не по самому расширению: .doc и .odt для читателя — одно и то же.
//
// Палитра — прямые tailwind-цвета, а не токены темы: токены задают роли интерфейса
// (primary, destructive), а здесь нужен признак типа, и «красный» у PDF ничего не сообщает
// об опасности. Оттенки разведены по светлой и тёмной теме вручную, чтобы белая подпись
// читалась на обеих.

export interface FileKind {
  /** Подпись на значке: до четырёх символов, иначе на нём не помещается. */
  ext: string
  /** Классы заливки значка. */
  className: string
}

const GROUPS: { className: string; exts: string[] }[] = [
  { className: 'bg-rose-500', exts: ['pdf'] },
  { className: 'bg-blue-500', exts: ['doc', 'docx', 'odt', 'rtf', 'pages'] },
  { className: 'bg-emerald-600', exts: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'] },
  { className: 'bg-orange-500', exts: ['ppt', 'pptx', 'odp', 'key'] },
  {
    className: 'bg-amber-600',
    exts: ['zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz', 'zst'],
  },
  { className: 'bg-violet-500', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'] },
  { className: 'bg-fuchsia-500', exts: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] },
  { className: 'bg-pink-500', exts: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] },
  {
    className: 'bg-slate-500',
    exts: ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf'],
  },
  {
    className: 'bg-cyan-600',
    exts: [
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'go',
      'rs',
      'php',
      'rb',
      'sql',
      'sh',
      'c',
      'cpp',
      'cs',
      'kt',
      'swift',
    ],
  },
]

/** Длиннее этого хвост имени после точки — уже не расширение, а часть названия. */
const EXT_MAX = 8

/** Столько символов помещается на значке; остальное режем, но группу ищем по полному. */
const EXT_LABEL_MAX = 4

/** Расширение по имени файла, иначе — по mime. Пусто — значит показываем общий значок. */
function extOf(name: string | null | undefined, mime: string | null | undefined): string {
  const fromName = (name ?? '').split('.').pop() ?? ''
  if (fromName && fromName !== name && fromName.length <= EXT_MAX) return fromName.toLowerCase()
  const sub = (mime ?? '').split('/')[1] ?? ''
  return sub.length <= EXT_MAX ? sub.toLowerCase() : ''
}

export function fileKind(name: string | null | undefined, mime?: string | null): FileKind {
  const ext = extOf(name, mime)
  const group = GROUPS.find((g) => g.exts.includes(ext))
  // Подпись режется, поиск группы — нет: у `.sqlite3` на значке уместится «sqli», но цвет
  // должен подбираться по полному расширению, иначе обрезок не совпадёт ни с одной группой.
  return { ext: ext.slice(0, EXT_LABEL_MAX), className: group?.className ?? 'bg-muted-foreground' }
}
