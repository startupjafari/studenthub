#if DEBUG
    import Foundation

    /// Данные mock API — детерминированные: фиксированные id, даты от одной точки
    /// отсчёта, никакого `Date()` и случайности. Снимок экрана из прогона в прогон один и тот
    /// же, а тест знает, какие строки увидит.
    ///
    /// JSON собирается словарями: формы ответов повторяют контракт API (`PROJECT.md §8`),
    /// и декодируют их те же модели приложения, что и ответы настоящего сервера.
    enum MockFixtures {
        typealias JSON = [String: Any]

        // MARK: - Кто вошёл

        static let studentID = "u-student"
        static let universityID = "uni-1"
        static let groupID = "grp-1"
        static let login = "student@test.local"
        static let password = "Test1234!"
        static let refreshCookie = "mock-refresh-token"

        /// Access-токен в форме JWT: подпись приложение не проверяет, а роль, scope и
        /// срок читает из полезной нагрузки. Срок — 2100 год, чтобы токен не истёк посреди
        /// прогона и не заводил продление.
        static let studentAccessToken: String = {
            let header = base64URL(#"{"alg":"none","typ":"JWT"}"#)
            let payload = base64URL(
                #"{"sub":"u-student","role":"STUDENT","universityId":"uni-1","groupId":"grp-1","iat":4102443900,"exp":4102444800}"#
            )
            return "\(header).\(payload).mock"
        }()

        private static func base64URL(_ string: String) -> String {
            Data(string.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }

        // MARK: - Время

        /// Точка отсчёта всех дат фикстур: вторник, 10 ноября 2026, 09:00 UTC.
        static let epoch: TimeInterval = 1_794_301_200

        static func date(minutesBefore minutes: Int) -> String {
            iso(Date(timeIntervalSince1970: epoch - TimeInterval(minutes * 60)))
        }

        static func iso(_ date: Date) -> String {
            formatter.string(from: date)
        }

        private static let formatter: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()

        // MARK: - Люди

        struct Person {
            let id: String
            let firstName: String
            let lastName: String

            var json: JSON { ["id": id, "firstName": firstName, "lastName": lastName] }
        }

        static let student = Person(id: studentID, firstName: "Алия", lastName: "Нурланова")
        static let people: [Person] = [
            Person(id: "u-1", firstName: "Даурен", lastName: "Ахметов"),
            Person(id: "u-2", firstName: "Мария", lastName: "Ким"),
            Person(id: "u-3", firstName: "Арман", lastName: "Сейткали"),
            Person(id: "u-4", firstName: "Елена", lastName: "Петрова"),
            Person(id: "u-5", firstName: "Тимур", lastName: "Жумабаев"),
            Person(id: "u-6", firstName: "Айгерим", lastName: "Касымова"),
        ]

        static func person(_ index: Int) -> Person {
            people[index % people.count]
        }

        // MARK: - Профиль и служебное

        static var me: JSON {
            [
                "id": studentID,
                "firstName": student.firstName,
                "lastName": student.lastName,
                "email": login,
                "username": "aliya.n",
                "role": "STUDENT",
                "groupName": "ИС-21",
                "facultyName": "Факультет информационных технологий",
                "universityName": "Тестовый университет",
                "bio": "Студентка третьего курса",
                "course": 3,
                "groupId": groupID,
                "universityId": universityID,
                "twoFactorEnabled": false,
                "locale": "ru",
            ]
        }

        static func user(id: String) -> JSON {
            guard let person = people.first(where: { $0.id == id }) else { return me }
            return person.json.merging(["role": "STUDENT", "groupName": "ИС-21", "universityName": "Тестовый университет"]) { $1 }
        }

        static let clientVersion: JSON = ["platform": "ios", "minimumVersion": "0.0.0"]
        static let consent: JSON = ["required": false, "guardianRequired": false, "birthDateRequired": false]
        static let profileCounts: JSON = ["photos": 0, "videos": 0, "articles": 0, "polls": 0]
        static let schedule: JSON = ["timezone": "Asia/Almaty", "pairs": [Any]()]

        static let notifications: [JSON] = (0..<3).map { index in
            [
                "id": "n-\(index + 1)",
                "type": "SYSTEM",
                "title": ["Новое задание", "Изменение в расписании", "Ответ на заявку"][index],
                "body": ["Курсовая работа: срок — пятница", "Пара перенесена в ауд. 305", "Справка готова"][index],
                "isRead": index > 0,
                "createdAt": date(minutesBefore: 30 * (index + 1)),
            ]
        }

        // MARK: - Чаты

        static var chatCount: Int { UITestEnvironment.current.isLarge ? 320 : 6 }

        /// Сообщений в чате. В большом режиме первый чат — длинная переписка для замера
        /// прокрутки.
        static func messageCount(chatIndex: Int) -> Int {
            if UITestEnvironment.current.isLarge, chatIndex == 0 { return 2000 }
            return chatIndex == 0 ? 40 : 12
        }

        static func chatID(_ index: Int) -> String { "chat-\(index + 1)" }

        static func chatIndex(of id: String) -> Int? {
            guard id.hasPrefix("chat-"), let number = Int(id.dropFirst(5)), number >= 1, number <= chatCount else {
                return nil
            }
            return number - 1
        }

        private static let groupTitles = ["ИС-21 · Группа", "Курсовая работа", "Староста и деканат", "Олимпиада по алгоритмам"]

        /// Чётные — личные, нечётные — группы.
        static func isGroup(_ index: Int) -> Bool { index % 2 == 1 }

        static func chatTitle(_ index: Int) -> String {
            if isGroup(index) {
                let base = groupTitles[(index / 2) % groupTitles.count]
                return index < 8 ? base : "\(base) \(index / 8 + 1)"
            }
            let person = person(index / 2)
            return "\(person.lastName) \(person.firstName)"
        }

        static func chat(_ index: Int, lastMessage: JSON?) -> JSON {
            var chat: JSON = [
                "id": chatID(index),
                "type": isGroup(index) ? "GROUP" : "PRIVATE",
                "unreadCount": index < 2 ? 2 - index : 0,
                "updatedAt": date(minutesBefore: index * 7),
            ]
            if isGroup(index) {
                chat["title"] = chatTitle(index)
                chat["memberCount"] = 24
            } else {
                // У личного чата название — имя собеседника, как отдаёт сервер.
                chat["title"] = chatTitle(index)
                chat["online"] = index == 0
            }
            if let lastMessage { chat["lastMessage"] = lastMessage }
            return chat
        }

        /// Сообщение `position` чата: 0 — самое свежее.
        static func message(chatIndex: Int, position: Int) -> JSON {
            let total = messageCount(chatIndex: chatIndex)
            let seq = total - position
            let mine = position % 3 == 1
            let sender = mine ? student : person(chatIndex / 2 + (isGroup(chatIndex) ? position % 3 : 0))
            let texts = [
                "Привет! Ты сегодня на паре будешь?",
                "Да, буду к второй паре.",
                "Скинь, пожалуйста, методичку по курсовой.",
                "Конечно, вечером отправлю.",
                "Лабораторную по базам данных перенесли на четверг.",
                "Отлично, успею доделать отчёт.",
                "Встречаемся в 14:00 у библиотеки.",
                "Хорошо, договорились 👍",
            ]
            return [
                "id": "\(chatID(chatIndex))-m\(seq)",
                "chatId": chatID(chatIndex),
                "seq": seq,
                "senderId": sender.id,
                "sender": sender.json,
                "content": texts[(seq + chatIndex) % texts.count],
                "createdAt": date(minutesBefore: chatIndex * 7 + position * 3),
            ]
        }

        static let chatMembers: [JSON] = [
            student.json.merging(["avatarUrl": NSNull(), "role": "STUDENT", "online": true]) { $1 },
            people[0].json.merging(["avatarUrl": NSNull(), "role": "STUDENT", "online": true]) { $1 },
        ]

        // MARK: - Лента

        static var postCount: Int { UITestEnvironment.current.isLarge ? 220 : 8 }

        static func postID(_ index: Int) -> String { "post-\(index + 1)" }

        static func postIndex(of id: String) -> Int? {
            guard id.hasPrefix("post-"), let number = Int(id.dropFirst(5)), number >= 1, number <= postCount else {
                return nil
            }
            return number - 1
        }

        static func post(_ index: Int, extraComments: Int = 0) -> JSON {
            let author = person(index)
            let texts = [
                "Завтра в актовом зале — встреча с выпускниками. Начало в 15:00, вход свободный.",
                "Открыта запись на олимпиаду по алгоритмам. Команды до трёх человек, регистрация до пятницы.",
                "Библиотека продлевает часы работы на время сессии: теперь до 22:00.",
                "Поздравляем нашу команду с победой в хакатоне! 🎉",
                "Напоминание: курсовые работы сдаются до 1 декабря.",
            ]
            let created: String = date(minutesBefore: 45 * index + 10)
            var authorJSON: JSON = author.json
            authorJSON["role"] = "STUDENT"
            var reactions: [JSON] = []
            if index % 2 == 0 {
                let reaction: JSON = ["emoji": "❤️", "count": 3 + index % 5, "mine": false]
                reactions.append(reaction)
            }
            let counts: JSON = ["comments": 3 + extraComments]
            var post: JSON = [:]
            post["id"] = postID(index)
            post["content"] = texts[index % texts.count]
            post["createdAt"] = created
            post["publishedAt"] = created
            post["author"] = authorJSON
            post["authorId"] = author.id
            post["audience"] = "UNIVERSITY"
            post["media"] = [Any]()
            post["reactionSummary"] = reactions
            post["_count"] = counts
            post["views"] = 40 + index
            post["bookmarked"] = false
            post["canDelete"] = false
            return post
        }

        static func comment(postIndex: Int, position: Int) -> JSON {
            let author = person(postIndex + position + 1)
            let texts = ["Отличная новость!", "А запись будет?", "Спасибо за информацию 🙏"]
            return [
                "id": "\(postID(postIndex))-c\(position + 1)",
                "content": texts[position % texts.count],
                "createdAt": date(minutesBefore: 45 * postIndex + 5 - position),
                "author": author.json,
                "canDelete": false,
            ]
        }

        /// Истории: текстовые, без медиа — снимку не нужна сеть картинок.
        static var storyRings: [JSON] {
            (0..<3).map { index in
                let author = person(index + 1)
                return [
                    "author": author.json,
                    "hasUnseen": index < 2,
                    "stories": [
                        [
                            "id": "story-\(index + 1)",
                            "text": ["Сегодня день открытых дверей!", "Готовимся к сессии 📚", "Хакатон: итоги"][index],
                            "background": ["ocean", "sunset", "forest"][index],
                            "createdAt": date(minutesBefore: 60 * (index + 1)),
                            "seen": index >= 2,
                            "canDelete": false,
                        ] as JSON,
                    ],
                ]
            }
        }
    }
#endif
