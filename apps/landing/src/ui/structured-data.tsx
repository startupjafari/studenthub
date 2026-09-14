import { SITE_URL, localePath, type Locale } from '../config/site'
import type { Dictionary } from '../content'

/**
 * Разметка для поисковиков (JSON-LD).
 *
 * Собирается из того же словаря, что и видимый текст: иначе ответы в выдаче и ответы на
 * странице неизбежно разъезжаются, а это прямой повод для санкций — поисковик считает
 * такое попыткой показать ему не то, что показано человеку.
 *
 * `FAQPage` даёт развёрнутый сниппет, и он тут уместен: вопросы на странице настоящие,
 * а не придуманы ради разметки.
 */
export function StructuredData({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const url = `${SITE_URL}${localePath(locale)}`

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}#organization`,
        name: 'StudentHub',
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        description: dict.meta.description,
      },
      {
        '@type': 'SoftwareApplication',
        name: 'StudentHub',
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        url,
        description: dict.meta.description,
        inLanguage: locale,
        publisher: { '@id': `${SITE_URL}#organization` },
        // Цены на странице нет намеренно (продажа вузу — разговор, а не корзина),
        // поэтому и offers здесь не заявляем: пустой оффер хуже отсутствующего.
      },
      {
        '@type': 'FAQPage',
        mainEntity: dict.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      // Единственный безопасный способ отдать JSON-LD в React. Источник — наши же
      // словари, пользовательского ввода здесь нет и быть не может.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
