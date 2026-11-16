import SwiftUI

/// Документы: свои, архив, открытые мне, запросы; загрузка, доступ, правка.
///
/// Ссылка на файл запрашивается в момент открытия, а не хранится: она подписанная
/// и короткоживущая, и сохранённая вчера сегодня ведёт в отказ. Сам экран —
/// `CommunityDocumentsScreen`; раздел может выключить платформа.
struct DocumentsView: View {
    var body: some View {
        CommunitySectionGate(section: "documents") { CommunityDocumentsScreen() }
    }
}
