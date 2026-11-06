import { createLucideIcon } from 'lucide-react'

// Брендовые иконки: lucide-react 1.x убрал логотипы (Instagram, LinkedIn и др.) из набора.
// Контуры перенесены из lucide-react 0.548 как есть и собраны через createLucideIcon —
// это обычный LucideIcon с тем же API (size, strokeWidth, className, color), поэтому
// подставляется везде, где ожидается иконка lucide.
export const Instagram = createLucideIcon({
  name: 'instagram',
  node: [
    ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: '2e1cvw' }],
    ['path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', key: '9exkf1' }],
    ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5', key: 'r4j83e' }],
  ],
})

export const Linkedin = createLucideIcon({
  name: 'linkedin',
  node: [
    [
      'path',
      {
        d: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z',
        key: 'c2jq9f',
      },
    ],
    ['rect', { width: '4', height: '12', x: '2', y: '9', key: 'mk3on5' }],
    ['circle', { cx: '4', cy: '4', r: '2', key: 'bt5ra8' }],
  ],
})
