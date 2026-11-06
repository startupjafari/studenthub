// Lighthouse CI — критерий релиза v1.0 «производительность и доступность ≥ 90 на мобильном»
// (docs/IMPLEMENTATION_PLAN.md, Фаза 13). Прогон — .github/workflows/lighthouse.yml.
//
// Мобильная эмуляция — пресет Lighthouse по умолчанию (Moto G Power, медленный 4G,
// замедление CPU в 4 раза), поэтому `preset` не задаём: `desktop` здесь был бы подменой
// критерия. Пороги не занижаем: оба 0.9.
//
// Доступность — ошибка на всех страницах. Производительность — ошибка на лендинге, входе и
// юридических; предупреждение осталось у страниц за входом: главной студента (`/`),
// расписания и чатов — задача 21.B4.
//
// Что упирается за входом. До 21.B4 веб давал 0.68–0.79 на всех страницах: каждой
// отдавались весь словарь и ~2,5 МБ JS (barrel'ы через серверные импорты, редактор tiptap,
// пикер эмодзи, Sentry). Это убрано, но страницы за входом несут оболочку (поиск,
// уведомления, счётчики, сокет), а главная и чаты — ещё и свой тяжёлый экран: ленту со
// сторис и окно чата (~4 тыс. строк, сообщения и поле ввода в одном модуле), ~520 КБ JS на
// старте. Расписание на локальном стенде — 0.76–0.86, главная и чаты — 0.61–0.84.
// В симуляции Lighthouse (lantern) LCP считается по всем запросам, начатым до реальной
// первой отрисовки, а на localhost она случается после загрузки почти всех скриптов
// страницы, — поэтому LCP здесь ~3–4 с при реальных 150 мс.
// Дальше — дробить окно чата (список отдельно от переписки), ленивое socket.io в
// RealtimeProvider. Как страница стабильно даст 0.9 в CI — перенести её в ERROR_PERFORMANCE.
//
// URL'ы задаются в workflow (`--collect.url=…`), а не здесь: публичные страницы
// снимаются одним вызовом, страницы за входом — отдельными, каждая со свежей cookie сессии
// (см. комментарий в workflow), а пороги к ним применяются по шаблону URL — правилами ниже.

/** Медиана из трёх прогонов: один прогон на общем раннере шумит на ±5 баллов. */
const RUNS = 3

// Медиана по прогонам одного URL, а не худший (aggregationMethod ниже): иначе один шумный
// прогон краснит страницу, у которой с производительностью всё в порядке.
//
// Порты — стенда из lighthouse.yml: 3002 — лендинг, 3100 — веб.
/** Производительность ≥ 0.9 — ошибка: лендинг, вход, юридические. */
const ERROR_PERFORMANCE =
  '^http://localhost:3002/$|^http://localhost:3100/(login|legal/privacy|legal/terms)$'
/** Производительность ≥ 0.9 — пока предупреждение (почему — в шапке файла). */
const WARN_PERFORMANCE = '^http://localhost:3100/(schedule|chats)?$'

module.exports = {
  ci: {
    collect: {
      numberOfRuns: RUNS,
      settings: {
        // Только две категории критерия: SEO и best-practices к релизу не относятся,
        // а каждая лишняя категория — секунды на каждом из прогонов.
        onlyCategories: ['performance', 'accessibility'],
        // Раннер GitHub без GPU и без sandbox-а user namespaces.
        //
        // Три флага против «фоновой» вкладки: headless Chrome на раннере иногда считает её
        // скрытой и замораживает таймеры, отрисовку и CSS-анимации. Первый экран лендинга
        // проявляется анимацией из opacity 0, и в такой вкладке он оставался прозрачным —
        // прогон падал с NO_FCP («контент не был отрисован»), хотя страница рабочая.
        chromeFlags: [
          '--no-sandbox',
          '--headless=new',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ].join(' '),
        locale: 'ru',
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: '.*',
          aggregationMethod: 'median-run',
          assertions: { 'categories:accessibility': ['error', { minScore: 0.9 }] },
        },
        {
          matchingUrlPattern: ERROR_PERFORMANCE,
          aggregationMethod: 'median-run',
          assertions: { 'categories:performance': ['error', { minScore: 0.9 }] },
        },
        {
          matchingUrlPattern: WARN_PERFORMANCE,
          aggregationMethod: 'median-run',
          assertions: { 'categories:performance': ['warn', { minScore: 0.9 }] },
        },
      ],
    },
    upload: {
      // Отчёты — артефактом прогона. temporary-public-storage отдал бы их на чужой
      // публичный сервер, а на страницах за входом — имена и данные стенда.
      target: 'filesystem',
      outputDir: './lhci-report',
    },
  },
}
