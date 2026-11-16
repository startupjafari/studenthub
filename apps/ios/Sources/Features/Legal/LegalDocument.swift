import Foundation

// Тексты документов — дословно из веба (`apps/web/messages/*.json`, раздел `Legal`), чтобы
// на телефоне и в браузере человек принимал одно и то же. Файл сгенерирован из сообщений
// веба; правка документа — сначала там, затем здесь и в каталоге строк (ru и kk).

/// Юридический документ платформы.
enum LegalDocument: String, Hashable, CaseIterable, Identifiable {
    case privacy
    case terms

    var id: String { rawValue }

    struct Section: Identifiable, Equatable {
        let id: Int
        let heading: String
        let body: String
    }

    /// Дата редакции — одна на оба документа, как в вебе (`Legal.updated`).
    static var updated: String {
        String(localized: "legal.updated", defaultValue: "Редакция от 30 сентября 2026 года")
    }


    private static var privacyTitle: String {
        String(localized: "legal.privacy.title", defaultValue: "Политика конфиденциальности")
    }

    private static var privacyIntro: String {
        String(localized: "legal.privacy.intro", defaultValue: "StudentHub — закрытая платформа, доступ к которой ваш университет открывает по приглашению. Здесь описано, какие данные обрабатываются, зачем и кто их видит.")
    }

    private static var privacySections: [Section] {
        [
            Section(
                id: 1,
                heading: String(localized: "legal.privacy.s1.heading", defaultValue: "1. Кто обрабатывает данные"),
                body: String(
                    localized: "legal.privacy.s1.body",
                    defaultValue: "Оператором персональных данных выступает университет, который выдал вам приглашение. StudentHub обрабатывает данные по его поручению и в объёме, необходимом для работы платформы."
                )
            ),
            Section(
                id: 2,
                heading: String(localized: "legal.privacy.s2.heading", defaultValue: "2. Какие данные обрабатываются"),
                body: String(
                    localized: "legal.privacy.s2.body",
                    defaultValue: "Учётные данные: имя и фамилия, email, имя пользователя, роль, факультет и группа. Профиль: фото, контакты и сведения, которые вы заполняете сами. Учебные данные: расписание, заявки, оценки, посещаемость, работы и документы. Содержимое, которое вы публикуете: посты, комментарии, сообщения и файлы. Технические данные: адрес подключения, тип устройства и браузера, время входа."
                )
            ),
            Section(
                id: 3,
                heading: String(localized: "legal.privacy.s3.heading", defaultValue: "3. Зачем это нужно"),
                body: String(
                    localized: "legal.privacy.s3.body",
                    defaultValue: "Данные используются, чтобы дать вам доступ к учебным сервисам, показать расписание и оценки, обработать заявки, обеспечить общение внутри университета, защитить аккаунт от чужого входа и разобрать жалобы на нарушения."
                )
            ),
            Section(
                id: 4,
                heading: String(localized: "legal.privacy.s4.heading", defaultValue: "4. Кто видит ваши данные"),
                body: String(
                    localized: "legal.privacy.s4.body",
                    defaultValue: "Видимость профиля вы настраиваете сами в настройках. Преподаватели, староста и деканат видят учебные данные в пределах своих групп и курсов. Администраторы университета видят учётные записи своего вуза. Сотрудники платформы получают доступ только в рамках технической поддержки и разбора инцидентов."
                )
            ),
            Section(
                id: 5,
                heading: String(localized: "legal.privacy.s5.heading", defaultValue: "5. Хранение и защита"),
                body: String(
                    localized: "legal.privacy.s5.body",
                    defaultValue: "Пароль хранится только в виде необратимого хэша — восстановить его невозможно, поэтому мы никогда не спрашиваем пароль. Соединение защищено HTTPS, для аккаунта доступна двухфакторная аутентификация. Данные хранятся, пока действует ваш аккаунт в университете, и удаляются либо обезличиваются по регламенту вуза после его закрытия."
                )
            ),
            Section(
                id: 6,
                heading: String(localized: "legal.privacy.s6.heading", defaultValue: "6. Ваши права"),
                body: String(
                    localized: "legal.privacy.s6.body",
                    defaultValue: "Вы можете просматривать и исправлять данные профиля, ограничивать их видимость, скрывать email и удалять свои публикации. Запрос на выгрузку, исправление или удаление данных подаётся администратору университета или в деканат."
                )
            ),
            Section(
                id: 7,
                heading: String(localized: "legal.privacy.s7.heading", defaultValue: "7. Cookies и хранилище браузера"),
                body: String(
                    localized: "legal.privacy.s7.body",
                    defaultValue: "Мы используем технические cookies для сессии входа и локальное хранилище браузера — для настроек интерфейса и черновиков. Рекламных и сторонних трекеров на платформе нет, данные не передаются рекламным сетям."
                )
            ),
            Section(
                id: 8,
                heading: String(localized: "legal.privacy.s8.heading", defaultValue: "8. Несовершеннолетние"),
                body: String(
                    localized: "legal.privacy.s8.body",
                    defaultValue: "Если вам ещё не исполнилось 18 лет, согласие на обработку персональных данных за вас даёт законный представитель — родитель или опекун: самостоятельное согласие несовершеннолетнего юридической силы не имеет. Такое согласие собирает университет при зачислении, вместе с остальными документами; платформа работает с данными в том объёме, в каком их передал университет."
                )
            ),
            Section(
                id: 9,
                heading: String(localized: "legal.privacy.s9.heading", defaultValue: "9. Изменения политики"),
                body: String(
                    localized: "legal.privacy.s9.body",
                    defaultValue: "Об изменениях мы сообщаем внутри платформы. Продолжая пользоваться StudentHub после обновления, вы принимаете новую редакцию."
                )
            ),
        ]
    }

    private static var termsTitle: String {
        String(localized: "legal.terms.title", defaultValue: "Пользовательское соглашение")
    }

    private static var termsIntro: String {
        String(localized: "legal.terms.intro", defaultValue: "Соглашение описывает правила пользования StudentHub. Начиная работу в платформе, вы принимаете эти условия.")
    }

    private static var termsSections: [Section] {
        [
            Section(
                id: 1,
                heading: String(localized: "legal.terms.s1.heading", defaultValue: "1. Общие положения"),
                body: String(
                    localized: "legal.terms.s1.body",
                    defaultValue: "Доступ к платформе предоставляет ваш университет. Регистрация возможна только по персональному приглашению; передавать ссылку-приглашение другим людям нельзя. Если вам ещё не исполнилось 18 лет, эти условия принимает за вас законный представитель."
                )
            ),
            Section(
                id: 2,
                heading: String(localized: "legal.terms.s2.heading", defaultValue: "2. Аккаунт"),
                body: String(
                    localized: "legal.terms.s2.body",
                    defaultValue: "Аккаунт принадлежит одному человеку. Не передавайте логин, пароль и коды подтверждения третьим лицам: все действия, совершённые под вашей учётной записью, считаются вашими. Если вы подозреваете, что доступ получил кто-то ещё, немедленно смените пароль и сообщите администратору вуза."
                )
            ),
            Section(
                id: 3,
                heading: String(localized: "legal.terms.s3.heading", defaultValue: "3. Правила поведения"),
                body: String(
                    localized: "legal.terms.s3.body",
                    defaultValue: "Запрещены оскорбления, травля и угрозы, разжигание вражды, спам и массовые рассылки, материалы для взрослых, публикация чужих персональных данных без согласия, выдача себя за другого человека или сотрудника, а также попытки обойти ограничения доступа."
                )
            ),
            Section(
                id: 4,
                heading: String(localized: "legal.terms.s4.heading", defaultValue: "4. Ваш контент"),
                body: String(
                    localized: "legal.terms.s4.body",
                    defaultValue: "Права на опубликованные вами материалы остаются за вами. Публикуя контент, вы разрешаете платформе хранить и показывать его тем участникам, которым он адресован. Вы отвечаете за законность того, что публикуете, и за наличие прав на используемые материалы."
                )
            ),
            Section(
                id: 5,
                heading: String(localized: "legal.terms.s5.heading", defaultValue: "5. Академическая честность"),
                body: String(
                    localized: "legal.terms.s5.body",
                    defaultValue: "Учебные материалы, работы и оценки в платформе относятся к учебному процессу вашего университета. Списывание, подмена авторства и распространение материалов закрытых испытаний оцениваются по правилам вуза."
                )
            ),
            Section(
                id: 6,
                heading: String(localized: "legal.terms.s6.heading", defaultValue: "6. Модерация"),
                body: String(
                    localized: "legal.terms.s6.body",
                    defaultValue: "На нарушения можно пожаловаться через встроенную форму. Модераторы и администрация университета вправе скрыть материал, ограничить доступ к отдельным функциям или заблокировать аккаунт. Решение можно оспорить, обратившись в деканат."
                )
            ),
            Section(
                id: 7,
                heading: String(localized: "legal.terms.s7.heading", defaultValue: "7. Доступность сервиса"),
                body: String(
                    localized: "legal.terms.s7.body",
                    defaultValue: "Платформа может быть временно недоступна из-за обслуживания или сбоев. Мы стараемся сокращать такие перерывы, но не гарантируем непрерывную работу и не отвечаем за последствия, вызванные обстоятельствами вне нашего контроля."
                )
            ),
            Section(
                id: 8,
                heading: String(localized: "legal.terms.s8.heading", defaultValue: "8. Изменения и прекращение доступа"),
                body: String(
                    localized: "legal.terms.s8.body",
                    defaultValue: "Условия могут обновляться; об изменениях мы сообщаем внутри платформы. Доступ прекращается при отчислении, увольнении или по решению университета. Данные после этого обрабатываются по регламенту вуза."
                )
            ),
        ]
    }

    var title: String {
        switch self {
        case .privacy: return Self.privacyTitle
        case .terms: return Self.termsTitle
        }
    }

    var intro: String {
        switch self {
        case .privacy: return Self.privacyIntro
        case .terms: return Self.termsIntro
        }
    }

    var sections: [Section] {
        switch self {
        case .privacy: return Self.privacySections
        case .terms: return Self.termsSections
        }
    }

    var symbol: String {
        switch self {
        case .privacy: return "hand.raised"
        case .terms: return "doc.text"
        }
    }

    /// Второй документ — ссылка в конце первого, как в вебе.
    var other: LegalDocument {
        self == .privacy ? .terms : .privacy
    }
}
