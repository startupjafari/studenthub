import SwiftUI

/// Вкладка «Ещё»: разделы по роли плюс действия сессии.
///
/// Состав разделов берётся из одного места с разбором диплинков
/// (`MoreSection.sections(for:)`) — иначе ссылка открывала бы раздел, которого в
/// списке нет, и наоборот.
struct MoreView: View {
    let session: AppSessionModel
    let role: Role

    @State private var showsQRApprove = false
    /// Включённые вузом модули: пункт выключенного не показываем вовсе.
    @State private var enabledModules: Set<MoreSection> = []

    var body: some View {
        List {
            Section {
                ForEach(sections) { section in
                    NavigationLink(value: AppRoute.section(section)) {
                        Label(section.title, systemImage: section.symbol)
                            .font(Typography.body)
                    }
                }
            }
            .listRowBackground(Palette.card)

            Section {
                Button {
                    showsQRApprove = true
                } label: {
                    Label(
                        String(localized: "auth.qrApproveTitle", defaultValue: "Вход на другом устройстве"),
                        systemImage: "qrcode.viewfinder"
                    )
                    .font(Typography.body)
                }

                Button(role: .destructive) {
                    Task { await session.signOut() }
                } label: {
                    Label(
                        String(localized: "session.signOut", defaultValue: "Выйти"),
                        systemImage: "rectangle.portrait.and.arrow.right"
                    )
                    .font(Typography.body)
                }
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(AppTab.more.title))
        .sheet(isPresented: $showsQRApprove) {
            QRApproveView()
        }
        .task { await loadModules() }
    }

    /// Разделы роли и включённые модули — перед настройками, чтобы «Настройки» и
    /// дальше замыкали список.
    private var sections: [MoreSection] {
        var list = MoreSection.sections(for: role)
        let modules = MoreSection.modules(for: role).filter(enabledModules.contains)
        list.insert(contentsOf: modules, at: list.firstIndex(of: .settings) ?? list.endIndex)
        return list
    }

    /// Спрашиваем при каждом показе вкладки: админ вуза включает модуль, когда
    /// захочет, и пункт должен появиться без перезапуска приложения. Отказ сети пункт
    /// не прячет — прошлое знание лучше мигания.
    private func loadModules() async {
        guard MoreSection.modules(for: role).contains(.library) else { return }
        guard let settings = try? await LibraryAPI().settings() else { return }
        if settings.enabled {
            enabledModules.insert(.library)
        } else {
            enabledModules.remove(.library)
        }
    }
}
