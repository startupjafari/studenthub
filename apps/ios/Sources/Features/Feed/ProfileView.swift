import PhotosUI
import SwiftUI

/// Профиль: свой — с правкой, чужой — только чтение.
///
/// Один экран на оба случая намеренно: расходясь, они начинают по-разному
/// показывать одни и те же поля, и человек видит у себя не то, что видят у него.
struct ProfileView: View {
    /// `nil` — мой профиль.
    let userID: String?

    @State private var profile: UserProfileDTO?
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var bio = ""
    @State private var avatar: PhotosPickerItem?
    @State private var isSaving = false
    @State private var failure: String?
    @State private var savedAt: Date?

    private let api = FeedAPI()

    private var isMine: Bool { userID == nil }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
            }

            Section {
                HStack(spacing: Spacing.lg) {
                    AvatarView(url: profile?.avatarUrl, name: profile?.name)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(profile?.name ?? "")
                            .font(Typography.sectionTitle)
                        if let username = profile?.username {
                            Text(verbatim: "@\(username)")
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        if let group = profile?.groupName {
                            Text(group)
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }

                if isMine {
                    PhotosPicker(selection: $avatar, matching: .images) {
                        Label(
                            String(localized: "profile.changeAvatar", defaultValue: "Сменить фото"),
                            systemImage: "camera"
                        )
                    }
                }
            }
            .listRowBackground(Palette.card)

            if isMine {
                Section {
                    TextField(text: $lastName) {
                        Text(verbatim: String(localized: "profile.lastName", defaultValue: "Фамилия"))
                    }
                    TextField(text: $firstName) {
                        Text(verbatim: String(localized: "profile.firstName", defaultValue: "Имя"))
                    }
                    TextField(text: $bio, axis: .vertical) {
                        Text(verbatim: String(localized: "profile.bio", defaultValue: "О себе"))
                    }
                    .lineLimit(2...6)

                    Button {
                        Task { await save() }
                    } label: {
                        Text(isSaving
                            ? String(localized: "profile.saving", defaultValue: "Сохраняем…")
                            : String(localized: "common.save", defaultValue: "Сохранить"))
                    }
                    .disabled(isSaving)
                } header: {
                    Text(String(localized: "profile.personal", defaultValue: "Личные данные"))
                } footer: {
                    if savedAt != nil {
                        Text(String(localized: "profile.saved", defaultValue: "Сохранено"))
                            .foregroundStyle(Palette.success)
                    }
                }
                .listRowBackground(Palette.card)
            } else if let bio = profile?.bio, !bio.isEmpty {
                Section {
                    Text(bio).font(Typography.body)
                } header: {
                    Text(String(localized: "profile.about", defaultValue: "О себе"))
                }
                .listRowBackground(Palette.card)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "more.profile", defaultValue: "Профиль")))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: avatar) {
            Task { await uploadAvatar() }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            profile = try await (userID.map { try await api.user(id: $0) } ?? api.me())
            firstName = profile?.firstName ?? ""
            lastName = profile?.lastName ?? ""
            bio = profile?.bio ?? ""
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.updateProfile(
                firstName: firstName,
                lastName: lastName,
                bio: bio.isEmpty ? nil : bio
            )
            savedAt = Date()
            await load()
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    private func uploadAvatar() async {
        guard let avatar else { return }
        self.avatar = nil
        guard let data = try? await avatar.loadTransferable(type: Data.self) else { return }
        do {
            try await api.uploadAvatar(data, mime: "image/jpeg")
            await load()
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Аватар с запасным вариантом — буквой имени.
struct AvatarView: View {
    let url: String?
    let name: String?

    var body: some View {
        Group {
            if let raw = url, let link = URL(string: raw) {
                AsyncImage(url: link) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: ControlHeight.island, height: ControlHeight.island)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Palette.muted)
            Text(verbatim: name?.first.map { String($0).uppercased() } ?? "•")
                .font(Typography.sectionTitle)
                .foregroundStyle(Palette.mutedForeground)
        }
    }
}
