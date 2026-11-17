// Фон переписки, как обои в Telegram: мягкий градиент цвета бренда и поверх него узор из
// учебных мелочей. Узор — своя картинка (`public/chat-pattern.svg`), работает маской: от неё
// берётся только форма, а цвет — токен темы, поэтому в светлой и тёмной теме фон свой без
// второго файла. Лежит под лентой (`-z-10` внутри изолированной области переписки) и ловить
// указатель не должен.
export function ChatWallpaper() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background"
    >
      <div className="absolute inset-0 bg-linear-to-br from-primary/5 to-primary/15" />
      <div className="absolute inset-0 bg-primary/15 [-webkit-mask-image:url(/chat-pattern.svg)] [-webkit-mask-repeat:repeat] [-webkit-mask-size:320px_320px] [mask-image:url(/chat-pattern.svg)] [mask-repeat:repeat] [mask-size:320px_320px]" />
    </div>
  )
}
