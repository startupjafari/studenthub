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
  question: string
  answer: string
}

/** Какая сцена рисуется рядом с кадром дня. Список закрытый — под каждый ключ есть компонент. */
export type SceneKey = 'notification' | 'schedule' | 'request' | 'room' | 'studentId'

export interface DayFrame extends Item {
  /** Время в сюжете «один день» — оно же метка на шкале. */
  time: string
  /**
   * Слово под меткой. Без него шкала — набор цифр, которые сами по себе ничего не
   * сообщают: «12:15» не объясняет, что там происходит, а «Справка» объясняет.
   */
  label: string
  scene: SceneKey
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
    ctaProduct: string
    inviteHint: string
  }

  /**
   * Подписи внутри нарисованных сцен. Текста в них немного и он намеренно крупный:
   * это иллюстрации, а не копии экранов, и читать в них должно быть нечего, кроме сути.
   */
  scenes: {
    appName: string
    notification: {
      title: string
      text: string
      scheduleTitle: string
      pairName: string
      pairTeacher: string
      roomBefore: string
      roomAfter: string
      changedLabel: string
      nextPair: string
      nextPairTime: string
    }
    schedule: {
      title: string
      nowLabel: string
      pairs: { name: string; time: string; room: string }[]
    }
    request: {
      screenTitle: string
      title: string
      service: string
      steps: string[]
      etaLabel: string
      eta: string
      /** Приложенные документы — показывают, что заявка не пустая форма. */
      attachments: string[]
    }
    room: {
      scanHint: string
      roomName: string
      statusBusy: string
      busyUntil: string
      pairName: string
      group: string
      nextFree: string
    }
    studentId: {
      screenTitle: string
      cardLabel: string
      name: string
      faculty: string
      group: string
      validLabel: string
      valid: string
      passHint: string
      offlineBadge: string
    }
  }

  doors: {
    title: string
    subtitle: string
    student: Item
    company: Item
    verify: Item
    action: string
  }

  day: {
    title: string
    subtitle: string
    frames: DayFrame[]
    /** Подпись у шкалы времени — она же ярлык группы кнопок для скринридера. */
    timelineLabel: string
  }

  roles: {
    title: string
    subtitle: string
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
