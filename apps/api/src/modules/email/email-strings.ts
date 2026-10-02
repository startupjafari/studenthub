// Строки писем на трёх языках (docs/PROJECT.md §10.1).
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ В shared-config РЯДОМ С УВЕДОМЛЕНИЯМИ. Словарь уведомлений
// общий, потому что его строки рендерятся и на сервере, и в браузере. Письма рендерятся
// только на сервере: в вебе их не показывают никогда. Тащить полтора десятка килобайт
// почтовых формулировок в пакет, который попадает в бандл клиента, незачем.
//
// ПОЧЕМУ ФУНКЦИИ, А НЕ СТРОКИ С {подстановками}. У писем подстановки сложнее, чем у
// уведомлений: в одной фразе и имя, и название вуза, и экранирование части значений. При
// функции TypeScript проверит, что в казахский перевод передали ровно те же аргументы, что
// в русский, — забытый параметр станет ошибкой сборки, а не пустым местом в письме.
//
// ЧТО НЕ ПЕРЕВОДИТСЯ: BRAND, адреса, названия вузов и компаний, комментарии сотрудников,
// текст уведомления в письме-зеркале (он уже пришёл на языке получателя).

import { Role } from '@studenthub/shared-types'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@studenthub/shared-config'

const BRAND = 'StudentHub'

/**
 * Состав словаря. Эталон — русский: тип выводится из него, и у казахского с английским
 * не может оказаться ни лишней статьи, ни недостающей.
 */
export interface EmailDict {
  /** Атрибут lang у письма: почтовые клиенты по нему переносят слова и читают вслух. */
  htmlLang: string
  /**
   * Тег для Intl: им форматируются даты в письме. Отдельно от `htmlLang`, потому что у
   * Intl нужен регион — «15 қазан 2026 ж.» получается только с `kk-KZ`, а не с `kk`.
   */
  dateLocale: string
  /** Названия ролей для письма-приглашения. Зеркало ключей `Roles` в каталогах веба. */
  roles: Record<Role, string>
  common: {
    autoNote: string
    openApp: string
    linkFallback: string
    plainSignature: string
    settingsLink: (href: string) => string
    settingsPlain: string
  }
  facts: {
    role: string
    validUntil: string
    company: string
    application: string
    status: string
    group: string
    event: string
    startsAt: string
  }
  invite: {
    subject: string
    heading: string
    invitedBy: (name: string) => string
    invitedImpersonal: string
    lead: (who: string) => string
    preheader: (role: string, until: string) => string
    finish: string
    action: string
    note: string
    plainLead: (who: string) => string
    plainFinish: (url: string) => string
  }
  companyVerification: {
    subject: string
    heading: string
    preheader: (company: string) => string
    lead: (company: string) => string
    action: string
    note: string
    plainNote: string
  }
  welcome: {
    subject: string
    heading: (firstName: string) => string
    preheader: string
    lead: string
    hint: string
    plainLead: (firstName: string) => string
    plainWhat: string
  }
  applicationStatus: {
    subject: (id: string, status: string) => string
    heading: string
    preheader: (id: string, status: string) => string
    lead: (firstName: string) => string
    comment: (text: string) => string
  }
  demoVerification: {
    subject: string
    heading: string
    preheader: (university: string) => string
    lead: (university: string) => string
    action: string
    note: string
    plainNote: string
  }
  demoApproved: {
    subject: (university: string) => string
    heading: string
    preheader: string
    greeting: (contact: string) => string
    lead: (university: string) => string
    wizard: string
    wizardPlain: string
    action: string
    note: string
    notePlain: string
  }
  demoRejected: {
    subject: string
    heading: string
    preheader: (university: string) => string
    lead: (university: string) => string
    again: string
    noReply: string
  }
  scheduleChange: {
    subject: string
    heading: string
    lead: (firstName: string) => string
  }
  eventReminder: {
    subject: (title: string) => string
    heading: string
    preheader: (title: string, startsAt: string) => string
    lead: (firstName: string) => string
  }
  notificationMirror: {
    lead: (firstName: string) => string
  }
}

const RU: EmailDict = {
  htmlLang: 'ru',
  dateLocale: 'ru-RU',
  roles: {
    [Role.PLATFORM_ADMIN]: 'Администратор платформы',
    [Role.PLATFORM_MODERATOR]: 'Модератор платформы',
    [Role.UNIVERSITY_ADMIN]: 'Администратор университета',
    [Role.UNIVERSITY_MODERATOR]: 'Модератор университета',
    [Role.DEAN]: 'Декан',
    [Role.TEACHER]: 'Преподаватель',
    [Role.STAROSTA]: 'Староста',
    [Role.STUDENT]: 'Студент',
    [Role.EMPLOYER]: 'Работодатель',
  },
  common: {
    autoNote: `Это автоматическое письмо от платформы ${BRAND}. Отвечать на него не нужно.`,
    openApp: `Открыть ${BRAND}`,
    linkFallback: 'Если кнопка не открывается, скопируйте ссылку:',
    plainSignature: `— ${BRAND}. Это автоматическое письмо, отвечать на него не нужно.`,
    settingsLink: (href) => `Отключить письма можно в ${href}.`,
    settingsPlain: 'Отключить письма можно в настройках уведомлений.',
  },
  facts: {
    role: 'Роль',
    validUntil: 'Ссылка действует до',
    company: 'Компания',
    application: 'Заявка',
    status: 'Статус',
    group: 'Группа',
    event: 'Событие',
    startsAt: 'Начало',
  },
  invite: {
    subject: `Приглашение в ${BRAND}`,
    heading: `Приглашение в ${BRAND}`,
    invitedBy: (name) => `${name} приглашает вас`,
    invitedImpersonal: 'Вас пригласили',
    lead: (who) => `${who} присоединиться к платформе ${BRAND}.`,
    preheader: (role, until) => `Роль «${role}», ссылка действует до ${until}`,
    finish: 'Чтобы завершить регистрацию, перейдите по ссылке и задайте пароль.',
    action: 'Принять приглашение',
    note: 'Если вы не ожидали приглашение — просто проигнорируйте это письмо.',
    plainLead: (who) => `${who} присоединиться к ${BRAND}.`,
    plainFinish: (url) => `Завершите регистрацию по ссылке: ${url}`,
  },
  companyVerification: {
    subject: `Подтвердите email компании в ${BRAND}`,
    heading: 'Подтвердите адрес',
    preheader: (company) => `Компания «${company}» ждёт подтверждения адреса`,
    lead: (company) =>
      `Вы зарегистрировали компанию «${company}» в ${BRAND}. Подтвердите адрес, чтобы подать заявку на доступ к студентам университета.`,
    action: 'Подтвердить email',
    note: 'Если вы не регистрировались — просто проигнорируйте это письмо, аккаунт останется неактивным.',
    plainNote: 'Если вы не регистрировались — просто проигнорируйте это письмо.',
  },
  welcome: {
    subject: `Добро пожаловать в ${BRAND}`,
    heading: (firstName) => `Добро пожаловать, ${firstName}!`,
    preheader: 'Аккаунт создан — лента, расписание, заявки и чаты уже доступны',
    lead: `Ваш аккаунт в ${BRAND} создан. Теперь вам доступны лента, расписание, заявки, чаты и события вашего университета.`,
    hint: 'Загляните в профиль и настройте уведомления под себя.',
    plainLead: (firstName) => `Добро пожаловать, ${firstName}! Ваш аккаунт в ${BRAND} создан.`,
    plainWhat: 'Вам доступны лента, расписание, заявки, чаты и события вашего университета.',
  },
  applicationStatus: {
    subject: (id, status) => `Заявка ${id}: ${status}`,
    heading: 'Статус заявки изменён',
    preheader: (id, status) => `Заявка ${id} — ${status}`,
    lead: (firstName) => `${firstName}, статус вашей заявки изменился.`,
    comment: (text) => `Комментарий деканата: ${text}`,
  },
  demoVerification: {
    subject: `Подтвердите заявку на тестирование ${BRAND}`,
    heading: 'Подтвердите адрес',
    preheader: (university) => `Заявка вуза «${university}» ждёт подтверждения адреса`,
    lead: (university) =>
      `С этого адреса подали заявку на тестирование платформы ${BRAND} для «${university}». Подтвердите, что адрес ваш, — после этого заявку увидит наш сотрудник.`,
    action: 'Подтвердить адрес',
    note: 'Если заявку подавали не вы — просто проигнорируйте это письмо, дальше ничего не произойдёт.',
    plainNote: 'Если заявку подавали не вы — просто проигнорируйте это письмо.',
  },
  demoApproved: {
    subject: (university) => `Доступ к ${BRAND} для «${university}» открыт`,
    heading: 'Заявка одобрена',
    preheader: 'Заявка одобрена — ссылка для входа внутри',
    greeting: (contact) => `${contact}, здравствуйте.`,
    lead: (university) =>
      `Мы завели «${university}» на платформе ${BRAND} и открыли вам доступ администратора вуза.`,
    wizard:
      'После входа откроется мастер настройки: он проведёт по шагам — факультеты, специальности, группы, аудитории, семестр, предметы — и в конце покажет, чего не хватает для запуска. Пройти его можно не за один раз: сделанное сохраняется.',
    wizardPlain:
      'После входа откроется мастер настройки: факультеты, специальности, группы, аудитории, семестр, предметы. Пройти его можно не за один раз.',
    action: 'Начать настройку',
    note: 'Ссылка одноразовая и рассчитана на вас: по ней задаётся пароль вашего аккаунта. Передавать её коллегам не нужно — их вы пригласите сами из платформы.',
    notePlain: 'Ссылка одноразовая: по ней задаётся пароль вашего аккаунта.',
  },
  demoRejected: {
    subject: `Заявка на тестирование ${BRAND}`,
    heading: 'Заявка рассмотрена',
    preheader: (university) => `Заявка вуза «${university}» рассмотрена`,
    lead: (university) =>
      `Спасибо за интерес к ${BRAND}. Заявку на тестирование для «${university}» мы сейчас принять не можем.`,
    again: 'Если что-то изменится, подайте заявку заново — мы посмотрим её как новую.',
    noReply: 'Отвечать на это письмо не нужно.',
  },
  scheduleChange: {
    subject: 'Изменение в расписании',
    heading: 'Расписание изменено',
    lead: (firstName) => `${firstName}, в расписании есть изменения.`,
  },
  eventReminder: {
    subject: (title) => `Напоминание: ${title}`,
    heading: 'Скоро начнётся событие',
    preheader: (title, startsAt) => `«${title}» начнётся ${startsAt}`,
    lead: (firstName) => `${firstName}, напоминаем о событии.`,
  },
  notificationMirror: {
    lead: (firstName) => `${firstName}, у вас новое уведомление:`,
  },
}

const KK: EmailDict = {
  htmlLang: 'kk',
  dateLocale: 'kk-KZ',
  roles: {
    [Role.PLATFORM_ADMIN]: 'Платформа әкімшісі',
    [Role.PLATFORM_MODERATOR]: 'Платформа модераторы',
    [Role.UNIVERSITY_ADMIN]: 'Университет әкімшісі',
    [Role.UNIVERSITY_MODERATOR]: 'Университет модераторы',
    [Role.DEAN]: 'Декан',
    [Role.TEACHER]: 'Оқытушы',
    [Role.STAROSTA]: 'Топ старостасы',
    [Role.STUDENT]: 'Студент',
    [Role.EMPLOYER]: 'Жұмыс беруші',
  },
  common: {
    autoNote: `Бұл — ${BRAND} платформасының автоматты хаты. Оған жауап берудің қажеті жоқ.`,
    openApp: `${BRAND} ашу`,
    linkFallback: 'Түйме ашылмаса, сілтемені көшіріп алыңыз:',
    plainSignature: `— ${BRAND}. Бұл автоматты хат, оған жауап берудің қажеті жоқ.`,
    settingsLink: (href) => `Хаттарды ${href} өшіруге болады.`,
    settingsPlain: 'Хаттарды хабарландыру баптауларынан өшіруге болады.',
  },
  facts: {
    role: 'Рөлі',
    validUntil: 'Сілтеме мерзімі',
    company: 'Компания',
    application: 'Өтініш',
    status: 'Мәртебесі',
    group: 'Тобы',
    event: 'Іс-шара',
    startsAt: 'Басталуы',
  },
  invite: {
    subject: `${BRAND} платформасына шақыру`,
    heading: `${BRAND} платформасына шақыру`,
    invitedBy: (name) => `${name} сізді шақырады`,
    invitedImpersonal: 'Сізді шақырды',
    lead: (who) => `${who} — ${BRAND} платформасына қосылуға.`,
    preheader: (role, until) => `«${role}» рөлі, сілтеме мерзімі ${until}`,
    finish: 'Тіркелуді аяқтау үшін сілтемеге өтіп, құпиясөз қойыңыз.',
    action: 'Шақыруды қабылдау',
    note: 'Егер шақыруды күтпеген болсаңыз — бұл хатты елемей қоя беріңіз.',
    plainLead: (who) => `${who} — ${BRAND} платформасына қосылуға.`,
    plainFinish: (url) => `Тіркелуді сілтеме арқылы аяқтаңыз: ${url}`,
  },
  companyVerification: {
    subject: `${BRAND} платформасында компания поштасын растаңыз`,
    heading: 'Поштаңызды растаңыз',
    preheader: (company) => `«${company}» компаниясы пошта расталуын күтуде`,
    lead: (company) =>
      `Сіз ${BRAND} платформасында «${company}» компаниясын тіркедіңіз. Университет студенттеріне қолжетімділікке өтініш беру үшін поштаңызды растаңыз.`,
    action: 'Поштаны растау',
    note: 'Егер тіркелмеген болсаңыз — бұл хатты елемей қоя беріңіз, тіркелгі белсенді болмай қалады.',
    plainNote: 'Егер тіркелмеген болсаңыз — бұл хатты елемей қоя беріңіз.',
  },
  welcome: {
    subject: `${BRAND} платформасына қош келдіңіз`,
    heading: (firstName) => `Қош келдіңіз, ${firstName}!`,
    preheader: 'Тіркелгі құрылды — лента, сабақ кестесі, өтініштер және чаттар қолжетімді',
    lead: `${BRAND} платформасындағы тіркелгіңіз құрылды. Енді сізге университетіңіздің лентасы, сабақ кестесі, өтініштері, чаттары мен іс-шаралары қолжетімді.`,
    hint: 'Профиліңізге кіріп, хабарландыруларды өзіңізге ыңғайлап баптаңыз.',
    plainLead: (firstName) =>
      `Қош келдіңіз, ${firstName}! ${BRAND} платформасындағы тіркелгіңіз құрылды.`,
    plainWhat:
      'Сізге университетіңіздің лентасы, сабақ кестесі, өтініштері, чаттары мен іс-шаралары қолжетімді.',
  },
  applicationStatus: {
    subject: (id, status) => `${id} өтініші: ${status}`,
    heading: 'Өтініш мәртебесі өзгерді',
    preheader: (id, status) => `${id} өтініші — ${status}`,
    lead: (firstName) => `${firstName}, өтінішіңіздің мәртебесі өзгерді.`,
    comment: (text) => `Деканат түсініктемесі: ${text}`,
  },
  demoVerification: {
    subject: `${BRAND} сынақтан өткізу өтінішін растаңыз`,
    heading: 'Поштаңызды растаңыз',
    preheader: (university) => `«${university}» жоғары оқу орнының өтініші растауды күтуде`,
    lead: (university) =>
      `Осы поштадан «${university}» үшін ${BRAND} платформасын сынақтан өткізуге өтініш берілді. Пошта сіздікі екенін растаңыз — содан кейін өтінішті қызметкеріміз қарайды.`,
    action: 'Поштаны растау',
    note: 'Егер өтінішті сіз бермеген болсаңыз — бұл хатты елемей қоя беріңіз, әрі қарай ештеңе болмайды.',
    plainNote: 'Егер өтінішті сіз бермеген болсаңыз — бұл хатты елемей қоя беріңіз.',
  },
  demoApproved: {
    subject: (university) => `«${university}» үшін ${BRAND} қолжетімділігі ашылды`,
    heading: 'Өтініш мақұлданды',
    preheader: 'Өтініш мақұлданды — кіру сілтемесі хаттың ішінде',
    greeting: (contact) => `${contact}, сәлеметсіз бе.`,
    lead: (university) =>
      `Біз «${university}» оқу орнын ${BRAND} платформасында аштық және сізге жоғары оқу орны әкімшісінің қолжетімділігін бердік.`,
    wizard:
      'Кіргеннен кейін баптау шебері ашылады: ол сізді қадамдармен өткізеді — факультеттер, мамандықтар, топтар, аудиториялар, семестр, пәндер — және соңында іске қосу үшін не жетіспейтінін көрсетеді. Оны бір отырыста аяқтау міндетті емес: жасалғаны сақталады.',
    wizardPlain:
      'Кіргеннен кейін баптау шебері ашылады: факультеттер, мамандықтар, топтар, аудиториялар, семестр, пәндер. Оны бір отырыста аяқтау міндетті емес.',
    action: 'Баптауды бастау',
    note: 'Сілтеме бір реттік және сізге арналған: ол арқылы тіркелгіңіздің құпиясөзі қойылады. Әріптестеріңізге беру қажет емес — оларды платформадан өзіңіз шақырасыз.',
    notePlain: 'Сілтеме бір реттік: ол арқылы тіркелгіңіздің құпиясөзі қойылады.',
  },
  demoRejected: {
    subject: `${BRAND} сынақтан өткізу өтініші`,
    heading: 'Өтініш қаралды',
    preheader: (university) => `«${university}» жоғары оқу орнының өтініші қаралды`,
    lead: (university) =>
      `${BRAND} платформасына қызығушылығыңыз үшін рақмет. «${university}» үшін сынақтан өткізу өтінішін қазір қабылдай алмаймыз.`,
    again: 'Жағдай өзгерсе, өтінішті қайта беріңіз — оны жаңа өтініш ретінде қараймыз.',
    noReply: 'Бұл хатқа жауап берудің қажеті жоқ.',
  },
  scheduleChange: {
    subject: 'Сабақ кестесіндегі өзгеріс',
    heading: 'Сабақ кестесі өзгерді',
    lead: (firstName) => `${firstName}, сабақ кестесінде өзгерістер бар.`,
  },
  eventReminder: {
    subject: (title) => `Еске салу: ${title}`,
    heading: 'Іс-шара жақында басталады',
    preheader: (title, startsAt) => `«${title}» ${startsAt} басталады`,
    lead: (firstName) => `${firstName}, іс-шара туралы еске саламыз.`,
  },
  notificationMirror: {
    lead: (firstName) => `${firstName}, сізде жаңа хабарландыру бар:`,
  },
}

const EN: EmailDict = {
  htmlLang: 'en',
  dateLocale: 'en-GB',
  roles: {
    [Role.PLATFORM_ADMIN]: 'Platform administrator',
    [Role.PLATFORM_MODERATOR]: 'Platform moderator',
    [Role.UNIVERSITY_ADMIN]: 'University administrator',
    [Role.UNIVERSITY_MODERATOR]: 'University moderator',
    [Role.DEAN]: 'Dean',
    [Role.TEACHER]: 'Teacher',
    [Role.STAROSTA]: 'Group leader',
    [Role.STUDENT]: 'Student',
    [Role.EMPLOYER]: 'Employer',
  },
  common: {
    autoNote: `This is an automated message from ${BRAND}. There is no need to reply.`,
    openApp: `Open ${BRAND}`,
    linkFallback: 'If the button does not work, copy this link:',
    plainSignature: `— ${BRAND}. This is an automated message; there is no need to reply.`,
    settingsLink: (href) => `You can turn these emails off in ${href}.`,
    settingsPlain: 'You can turn these emails off in your notification settings.',
  },
  facts: {
    role: 'Role',
    validUntil: 'Link valid until',
    company: 'Company',
    application: 'Application',
    status: 'Status',
    group: 'Group',
    event: 'Event',
    startsAt: 'Starts',
  },
  invite: {
    subject: `Invitation to ${BRAND}`,
    heading: `Invitation to ${BRAND}`,
    invitedBy: (name) => `${name} invites you`,
    invitedImpersonal: 'You have been invited',
    lead: (who) => `${who} to join ${BRAND}.`,
    preheader: (role, until) => `Role “${role}”, link valid until ${until}`,
    finish: 'To finish signing up, follow the link and set a password.',
    action: 'Accept invitation',
    note: 'If you were not expecting this invitation, simply ignore this message.',
    plainLead: (who) => `${who} to join ${BRAND}.`,
    plainFinish: (url) => `Finish signing up here: ${url}`,
  },
  companyVerification: {
    subject: `Confirm your company email on ${BRAND}`,
    heading: 'Confirm your email',
    preheader: (company) => `“${company}” is waiting for email confirmation`,
    lead: (company) =>
      `You registered “${company}” on ${BRAND}. Confirm your email address to apply for access to university students.`,
    action: 'Confirm email',
    note: 'If you did not register, simply ignore this message — the account will stay inactive.',
    plainNote: 'If you did not register, simply ignore this message.',
  },
  welcome: {
    subject: `Welcome to ${BRAND}`,
    heading: (firstName) => `Welcome, ${firstName}!`,
    preheader: 'Your account is ready — feed, schedule, applications and chats are available',
    lead: `Your ${BRAND} account has been created. You now have access to your university’s feed, schedule, applications, chats and events.`,
    hint: 'Open your profile and set up notifications the way you like.',
    plainLead: (firstName) => `Welcome, ${firstName}! Your ${BRAND} account has been created.`,
    plainWhat:
      'You have access to your university’s feed, schedule, applications, chats and events.',
  },
  applicationStatus: {
    subject: (id, status) => `Application ${id}: ${status}`,
    heading: 'Application status changed',
    preheader: (id, status) => `Application ${id} — ${status}`,
    lead: (firstName) => `${firstName}, the status of your application has changed.`,
    comment: (text) => `Dean’s office comment: ${text}`,
  },
  demoVerification: {
    subject: `Confirm your ${BRAND} trial request`,
    heading: 'Confirm your email',
    preheader: (university) => `The request from “${university}” is waiting for confirmation`,
    lead: (university) =>
      `A ${BRAND} trial request for “${university}” was submitted from this address. Confirm that the address is yours — after that a member of our team will review the request.`,
    action: 'Confirm address',
    note: 'If you did not submit this request, simply ignore this message — nothing further will happen.',
    plainNote: 'If you did not submit this request, simply ignore this message.',
  },
  demoApproved: {
    subject: (university) => `${BRAND} access for “${university}” is open`,
    heading: 'Request approved',
    preheader: 'Request approved — the sign-in link is inside',
    greeting: (contact) => `Hello ${contact},`,
    lead: (university) =>
      `We have set up “${university}” on ${BRAND} and given you university administrator access.`,
    wizard:
      'After signing in, a setup wizard will open: it walks you through faculties, specialties, groups, rooms, the semester and subjects, and at the end shows what is still missing before launch. You do not have to finish it in one go — your progress is saved.',
    wizardPlain:
      'After signing in, a setup wizard will open: faculties, specialties, groups, rooms, the semester and subjects. You do not have to finish it in one go.',
    action: 'Start setup',
    note: 'The link is single-use and meant for you: it sets the password for your account. There is no need to share it with colleagues — you will invite them from inside the platform.',
    notePlain: 'The link is single-use: it sets the password for your account.',
  },
  demoRejected: {
    subject: `${BRAND} trial request`,
    heading: 'Request reviewed',
    preheader: (university) => `The request from “${university}” has been reviewed`,
    lead: (university) =>
      `Thank you for your interest in ${BRAND}. We are unable to accept the trial request for “${university}” at this time.`,
    again: 'If something changes, submit a new request — we will review it as a fresh one.',
    noReply: 'There is no need to reply to this message.',
  },
  scheduleChange: {
    subject: 'Schedule change',
    heading: 'The schedule has changed',
    lead: (firstName) => `${firstName}, there are changes to your schedule.`,
  },
  eventReminder: {
    subject: (title) => `Reminder: ${title}`,
    heading: 'An event is starting soon',
    preheader: (title, startsAt) => `“${title}” starts ${startsAt}`,
    lead: (firstName) => `${firstName}, a reminder about an event.`,
  },
  notificationMirror: {
    lead: (firstName) => `${firstName}, you have a new notification:`,
  },
}

export const EMAIL_STRINGS: Record<Locale, EmailDict> = { ru: RU, kk: KK, en: EN }

/**
 * Словарь по языку получателя. Язык приходит из `User.locale` (у внешних адресатов его нет
 * вовсе) — то есть из данных, и доверять ему нельзя: неизвестное значение откатывается на
 * русский, а не роняет отправку.
 */
export function emailDict(locale?: string | null): EmailDict {
  return SUPPORTED_LOCALES.includes(locale as Locale)
    ? EMAIL_STRINGS[locale as Locale]
    : EMAIL_STRINGS[DEFAULT_LOCALE]
}
