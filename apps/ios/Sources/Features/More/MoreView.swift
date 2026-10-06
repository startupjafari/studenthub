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

    var body: some View {
        List {
            Section {
                ForEach(MoreSection.sections(for: role)) { section in
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
    }
}
