// Анимированный фон экранов входа/регистрации — виден только на мобильном (на десктопе слева
// стоит интерактивная mesh-панель). Плавающие размытые пятна + мягкая сетка + мелкие частицы.
// Чистый CSS (см. globals.css, .auth-*), без JS и без ре-рендеров; уважает prefers-reduced-motion.
export function AuthBackground() {
  return (
    <div className="auth-bg lg:hidden" aria-hidden>
      <span className="auth-blob auth-blob-a" />
      <span className="auth-blob auth-blob-b" />
      <span className="auth-blob auth-blob-c" />
      <div className="auth-grid" />
      <span className="auth-dot auth-dot-1" />
      <span className="auth-dot auth-dot-2" />
      <span className="auth-dot auth-dot-3" />
      <span className="auth-dot auth-dot-4" />
    </div>
  )
}
