import PhotosUI
import SwiftUI

/// Правка своего профиля: фото, обложка, имя, строка под именем, о себе, контакты,
/// навыки. Поля — только те, что роли разрешено менять самой (`PROFILE_FIELD_ROLES`):
/// курс, специальность и GPA студента ведёт деканат, и формы для них здесь нет.
struct ProfileEditView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @Environment(\.dismiss) private var dismiss

    @State private var form = ProfileForm()
    @State private var loadedID: String?
    @State private var avatarItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var uploading: Upload?
    @State private var isSaving = false
    @State private var failure: String?
    @State private var newSkill = ""
    @FocusState private var focused: Field?

    private let api: AccountFetching = AccountAPI()
    private let feed: FeedFetching = FeedAPI()

    private enum Field: Hashable {
        case firstName, lastName, middleName, headline, bio, phone, telegram, instagram, website, skill
        case department, officeRoom, officeHours
    }

    private enum Upload { case avatar, cover }

    private var role: Role { viewer.profile?.role.flatMap(Role.init(rawValue:)) ?? .unknown }
    private var isStudent: Bool { role == .student || role == .starosta }
    private var canSave: Bool {
        !form.firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && !form.lastName.trimmingCharacters(in: .whitespaces).isEmpty
            && !isSaving && uploading == nil
            && form.websiteIsValid
    }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure).listRowBackground(Color.clear)
            }

            Section {
                HStack(spacing: Spacing.lg) {
                    ZStack {
                        AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: 72)
                        if uploading == .avatar { ProgressView() }
                    }
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        PhotosPicker(selection: $avatarItem, matching: .images) {
                            Label(String(localized: "profile.changeAvatar", defaultValue: "Сменить фото"), systemImage: "camera")
                        }
                        PhotosPicker(selection: $coverItem, matching: .images) {
                            HStack {
                                Label(String(localized: "profile.changeCover", defaultValue: "Сменить обложку"), systemImage: "photo")
                                if uploading == .cover { ProgressView() }
                            }
                        }
                    }
                    .font(Typography.body)
                }
                if viewer.profile?.avatarUrl != nil || viewer.profile?.coverUrl != nil {
                    Menu {
                        if viewer.profile?.avatarUrl != nil {
                            Button(String(localized: "profile.removeAvatar", defaultValue: "Удалить фото"), role: .destructive) {
                                Task { await remove(.avatar) }
                            }
                        }
                        if viewer.profile?.coverUrl != nil {
                            Button(String(localized: "profile.removeCover", defaultValue: "Удалить обложку"), role: .destructive) {
                                Task { await remove(.cover) }
                            }
                        }
                    } label: {
                        Text(String(localized: "profile.removeMedia", defaultValue: "Удалить…"))
                            .foregroundStyle(Palette.destructive)
                    }
                }
            }
            .listRowBackground(Palette.card)

            Section {
                TextField(String(localized: "profile.lastName", defaultValue: "Фамилия"), text: $form.lastName)
                    .textContentType(.familyName)
                    .focused($focused, equals: .lastName)
                TextField(String(localized: "profile.firstName", defaultValue: "Имя"), text: $form.firstName)
                    .textContentType(.givenName)
                    .focused($focused, equals: .firstName)
                TextField(String(localized: "profile.middleName", defaultValue: "Отчество"), text: $form.middleName)
                    .textContentType(.middleName)
                    .focused($focused, equals: .middleName)
            } header: {
                Text(String(localized: "profile.personal", defaultValue: "Личные данные"))
            }
            .listRowBackground(Palette.card)

            Section {
                TextField(String(localized: "profile.headline", defaultValue: "Строка под именем"), text: $form.headline)
                    .focused($focused, equals: .headline)
                TextField(String(localized: "profile.bio", defaultValue: "О себе"), text: $form.bio, axis: .vertical)
                    .lineLimit(3...8)
                    .focused($focused, equals: .bio)
            } header: {
                Text(String(localized: "profile.about", defaultValue: "О себе"))
            }
            .listRowBackground(Palette.card)

            Section {
                TextField(String(localized: "profile.phone", defaultValue: "Телефон"), text: $form.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .focused($focused, equals: .phone)
                TextField(String(localized: "profile.telegram", defaultValue: "Telegram (без @)"), text: $form.telegram)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .telegram)
                if isStudent {
                    TextField(String(localized: "profile.instagram", defaultValue: "Instagram (без @)"), text: $form.instagram)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused, equals: .instagram)
                }
                TextField(String(localized: "profile.website", defaultValue: "Сайт"), text: $form.website)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .website)
            } header: {
                Text(String(localized: "profile.contacts", defaultValue: "Контакты"))
            } footer: {
                if !form.websiteIsValid {
                    FieldError(message: String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://"))
                } else {
                    Text(String(localized: "profile.contacts.footer", defaultValue: "Кто видит почту и телефон — в «Настройки → Конфиденциальность»."))
                }
            }
            .listRowBackground(Palette.card)

            if role == .teacher {
                Section {
                    TextField(String(localized: "profile.department", defaultValue: "Кафедра"), text: $form.department)
                        .focused($focused, equals: .department)
                    TextField(String(localized: "profile.officeRoom", defaultValue: "Кабинет"), text: $form.officeRoom)
                        .focused($focused, equals: .officeRoom)
                    TextField(String(localized: "profile.officeHours", defaultValue: "Часы приёма"), text: $form.officeHours)
                        .focused($focused, equals: .officeHours)
                } header: {
                    Text(String(localized: "profile.work", defaultValue: "Работа"))
                }
                .listRowBackground(Palette.card)
            }

            if isStudent {
                Section {
                    ForEach(form.skills, id: \.self) { skill in
                        Text(skill)
                    }
                    .onDelete { form.skills.remove(atOffsets: $0) }
                    HStack {
                        TextField(String(localized: "profile.skills.add", defaultValue: "Добавить навык"), text: $newSkill)
                            .focused($focused, equals: .skill)
                            .submitLabel(.done)
                            .onSubmit(addSkill)
                        Button(action: addSkill) {
                            Image(systemName: "plus.circle.fill")
                        }
                        .disabled(newSkill.trimmingCharacters(in: .whitespaces).isEmpty || form.skills.count >= 30)
                        .accessibilityLabel(Text(String(localized: "profile.skills.add", defaultValue: "Добавить навык")))
                    }
                } header: {
                    Text(String(localized: "profile.skills", defaultValue: "Навыки"))
                } footer: {
                    Text(String(localized: "profile.skills.footer", defaultValue: "До 30 навыков. Смахните влево, чтобы удалить."))
                }
                .listRowBackground(Palette.card)
            }
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "profile.editTitle", defaultValue: "Изменить профиль")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(String(localized: "common.close", defaultValue: "Закрыть")) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving { ProgressView() } else { Text(String(localized: "common.save", defaultValue: "Сохранить")) }
                }
                .disabled(!canSave)
                .accessibilityIdentifier("profile.save")
            }
        }
        .onChange(of: avatarItem) { Task { await upload(.avatar) } }
        .onChange(of: coverItem) { Task { await upload(.cover) } }
        .task {
            if viewer.profile == nil { await viewer.refresh() }
            fill()
        }
    }

    /// Форму заполняем один раз: повторный показ экрана не должен стирать набранное.
    private func fill() {
        guard let profile = viewer.profile, loadedID != profile.id else { return }
        loadedID = profile.id
        form = ProfileForm(profile)
    }

    private func addSkill() {
        let skill = newSkill.trimmingCharacters(in: .whitespaces)
        guard !skill.isEmpty, skill.count <= 60, !form.skills.contains(skill), form.skills.count < 30 else { return }
        form.skills.append(skill)
        newSkill = ""
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await api.updateProfile(form.update(role: role))
            viewer.adopt(updated)
            failure = nil
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func upload(_ kind: Upload) async {
        guard let item = kind == .avatar ? avatarItem : coverItem else { return }
        if kind == .avatar { avatarItem = nil } else { coverItem = nil }
        uploading = kind
        defer { uploading = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Сжимаем на устройстве: фото камеры весит больше лимита в 10 МБ, а
            // сервер всё равно хранит уменьшенную копию.
            let jpeg = await Task.detached(priority: .userInitiated) {
                UIImage(data: data).flatMap { Self.downscaled($0, maxSide: kind == .avatar ? 1024 : 2048).jpegData(compressionQuality: 0.85) }
            }.value
            guard let jpeg else {
                failure = String(localized: "profile.imageUnreadable", defaultValue: "Не удалось прочитать изображение")
                return
            }
            if kind == .avatar {
                try await feed.uploadAvatar(jpeg, mime: "image/jpeg")
                await viewer.refresh()
            } else {
                viewer.adopt(try await api.uploadCover(jpeg, mime: "image/jpeg"))
            }
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func remove(_ kind: Upload) async {
        do {
            viewer.adopt(kind == .avatar ? try await api.removeAvatar() : try await api.removeCover())
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    nonisolated private static func downscaled(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let side = max(image.size.width, image.size.height)
        guard side > maxSide else { return image }
        let scale = maxSide / side
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

/// Значения формы. Отдельно от экрана — чтобы сборку PATCH можно было проверить тестом.
struct ProfileForm: Equatable {
    var firstName = ""
    var lastName = ""
    var middleName = ""
    var headline = ""
    var bio = ""
    var phone = ""
    var telegram = ""
    var instagram = ""
    var website = ""
    var skills: [String] = []
    var department = ""
    var officeRoom = ""
    var officeHours = ""

    init() {}

    init(_ profile: UserProfileDTO) {
        firstName = profile.firstName ?? ""
        lastName = profile.lastName ?? ""
        middleName = profile.middleName ?? ""
        headline = profile.headline ?? ""
        bio = profile.bio ?? ""
        phone = profile.phone ?? ""
        telegram = profile.telegram ?? ""
        instagram = profile.instagram ?? ""
        website = profile.website ?? ""
        skills = profile.skills ?? []
        department = profile.department ?? ""
        officeRoom = profile.officeRoom ?? ""
        officeHours = profile.officeHours ?? ""
    }

    var websiteIsValid: Bool {
        let value = website.trimmingCharacters(in: .whitespaces)
        return value.isEmpty || value.hasPrefix("http://") || value.hasPrefix("https://")
    }

    /// Тело PATCH. Пустая строка уходит как есть — так сервер очищает поле. Поля
    /// чужой роли не отправляются вовсе: схема строгая и ответила бы `400`.
    func update(role: Role) -> ProfileUpdate {
        func clean(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
        var update = ProfileUpdate(
            firstName: clean(firstName),
            lastName: clean(lastName),
            middleName: clean(middleName),
            headline: clean(headline),
            bio: clean(bio),
            phone: clean(phone),
            telegram: clean(telegram).trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        )
        switch role {
        case .student, .starosta:
            update.instagram = clean(instagram).trimmingCharacters(in: CharacterSet(charactersIn: "@"))
            update.website = clean(website)
            update.skills = skills
        case .teacher:
            update.website = clean(website)
            update.department = clean(department)
            update.officeRoom = clean(officeRoom)
            update.officeHours = clean(officeHours)
        default:
            break
        }
        return update
    }
}
