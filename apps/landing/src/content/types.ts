/**
 * Форма контента лендинга.
 *
 * Тип здесь играет роль, которую в платформе играет страж `shared/i18n/messages.test.ts`:
 * язык с пропущенным или лишним полем не соберётся. Проверять полноту переводов руками
 * не нужно — это делает компилятор.
 */

export interface Item {
  title: string
  text: string
}

export interface Qa {
  /**
   * Якорь вопроса. Нужен не для порядка: на вопрос о доступе ведёт кнопка из «Дверей»,
   * и без собственного идентификатора ссылка упиралась бы в начало всего списка.
   */
  id: string
  question: string
  answer: string
}

/** Дверь на страницу продукта: кому она и что за ней. */
export interface Door extends Item {
  /** Подпись действия. У каждой двери своё — они ведут в разные места. */
  action: string
}

/** Строка в рабочей области макета: настоящая запись, а не серая плашка. */
export interface RoleRow {
  title: string
  meta: string
  /** Правая колонка: оценка, время, статус — то, ради чего роль этот список и открывает. */
  value: string
}

export interface RoleTab extends Item {
  id: string
  /**
   * Разделы бокового меню. Первый — открытый: именно его заголовок стоит в `highlight`,
   * и именно он подсвечен в макете. Рассинхрон («открыты Мои пары, показана Ведомость»)
   * читается как ошибка состояния.
   */
  nav: string[]
  /** Заголовок рабочей области — содержимое открытого раздела `nav[0]`. */
  highlight: string
  /** Три-четыре права роли. Одно предложение описания их не передаёт. */
  rights: string[]
  /**
   * Область данных из токена, как её видит бэкенд. Печатается моноширинным и мелко:
   * это доказательство тезиса про scope, а не его повторение словами.
   */
  scope: string
  /** Содержимое открытого раздела — три строки. */
  rows: RoleRow[]
}

export interface Dictionary {
  meta: {
    title: string
    description: string
    languageName: string
  }

  nav: {
    product: string
    security: string
    rollout: string
    faq: string
    login: string
    demo: string
    /** Подписи кнопки-бургера — она иконочная, и без них у неё нет доступного имени. */
    menu: string
    close: string
  }

  hero: {
    eyebrow: string
    /**
     * Заголовок построчно. Перенос здесь смысловой: каждая строка выезжает из-под своей
     * маски, поэтому «как ляжет по ширине» тут не подходит — строки задаёт перевод.
     */
    titleLines: string[]
    subtitle: string
    ctaDemo: string
    ctaLogin: string
  }

  doors: {
    title: string
    subtitle: string
    university: Door
    /**
     * У этой двери два действия: войти тем, у кого доступ уже есть, и узнать, как его
     * получить, — остальным. Второе поле обязательное, а не `Door & { action?: ... }`:
     * необязательное поле не ловится компилятором при пропуске в переводе.
     */
    people: Door & { actionAccess: string }
    company: Door
  }

  roles: {
    title: string
    subtitle: string
    /** Имя продукта в шапке макета — оно же и в интерфейсе платформы. */
    appName: string
    tabs: RoleTab[]
  }

  security: {
    title: string
    subtitle: string
    points: Item[]
  }

  rollout: {
    title: string
    subtitle: string
    steps: Item[]
    note: string
  }

  scale: {
    title: string
    text: string
    /** Числа, которые набегают при появлении. Только проверяемые — выдуманных здесь нет. */
    stats: { value: number; unit?: string; label: string }[]
    facts: Item[]
  }

  faq: {
    title: string
    items: Qa[]
  }

  cta: {
    title: string
    text: string
    button: string
    mailSubject: string
  }

  footer: {
    tagline: string
    rights: string
    language: string
  }
}
