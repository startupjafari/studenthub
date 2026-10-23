// Lighthouse CI — критерий релиза v1.0 «производительность и доступность ≥ 90 на мобильном»
// (docs/IMPLEMENTATION_PLAN.md, Фаза 13). Прогон — .github/workflows/lighthouse.yml.
//
// Мобильная эмуляция — пресет Lighthouse по умолчанию (Moto G Power, медленный 4G,
// замедление CPU в 4 раза), поэтому `preset` не задаём: `desktop` здесь был бы подменой
// критерия. Пороги не занижаем — если страница не дотягивает, прогон краснеет, и это и есть
// сигнал, ради которого он заведён.
//
// URL'ы задаются в workflow (`--collect.url=…`), а не здесь: публичные страницы
// снимаются одним вызовом, страницы за входом — отдельными, каждая со свежей cookie сессии
// (см. комментарий в workflow), а сравниваются все одинаково — правилами ниже.

/** Медиана из трёх прогонов: один прогон на общем раннере шумит на ±5 баллов. */
const RUNS = 3

module.exports = {
  ci: {
    collect: {
      numberOfRuns: RUNS,
      settings: {
        // Только две категории критерия: SEO и best-practices к релизу не относятся,
        // а каждая лишняя категория — секунды на каждом из прогонов.
        onlyCategories: ['performance', 'accessibility'],
        // Раннер GitHub без GPU и без sandbox-а user namespaces.
        chromeFlags: '--no-sandbox --headless=new',
        locale: 'ru',
      },
    },
    assert: {
      // Медиана по прогонам одного URL, а не худший: иначе один шумный прогон краснит
      // страницу, у которой с производительностью всё в порядке.
      aggregationMethod: 'median-run',
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      // Отчёты — артефактом прогона. temporary-public-storage отдал бы их на чужой
      // публичный сервер, а на страницах за входом — имена и данные стенда.
      target: 'filesystem',
      outputDir: './lhci-report',
    },
  },
}
