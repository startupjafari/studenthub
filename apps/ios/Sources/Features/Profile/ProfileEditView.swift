import PhotosUI
import SwiftUI

/// Правка своего профиля: фото, обложка, имя, строка под именем, о себе, контакты,
/// навыки. Поля — только те, что роли разрешено менять самой (`PROFILE_FIELD_ROLES`):
/// курс, специальность и GPA студента ведёт деканат, и формы для них здесь нет.
///
/// Экран всегда открывается в стеке вкладки (из профиля и из настроек), поэтому выход
/// один — «Назад», и панель вкладок под ним видна. Пока есть несохранённое, системную
/// «Назад» заменяет своя: она спрашивает, сохранить ли, — системная ушла бы молча.
struct ProfileEditView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @Environment(\.dismiss) private var dismiss

    @State private var form = ProfileForm()
    /// Форма как пришла с сервера — по ней видно, есть ли несохранённое.
    @State private var original = ProfileForm()
    @State private var confirmingExit = false
    @State private var loadedID: String?
    @State private var avatarItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var uploading: Upload?
    /// Меню действий над фото или обложкой — у каждой своё, привязанное к снимку.
    @State private var avatarActions = false
    @State private var coverActions = false
    @State private var pickingAvatar = false
    @State private var pickingCover = false
    /// Съёмка камерой: для чего снимаем.
    @State private var shooting: Upload?
    /// Полноэкранный просмотр текущего фото или обложки.
    @State private var viewing: Upload?
    @State private var isSaving = false
    @State private var failure: String?
    @State private var newSkill = ""
    @FocusState private var focused: Field?
    @ScaledMetric(relativeTo: .title) private var avatarSize: CGFloat = 80

    private let api: AccountFetching = AccountAPI()
    private let feed: FeedFetching = FeedAPI()

    private enum Field: Hashable {
        case firstName, lastName, middleName, headline, bio, phone, telegram, instagram, website, skill
        case department, officeRoom, officeHours
    }

    private enum Upload { case avatar, cover }

    /// Метка ошибки над формой: к ней прокручивается экран, когда сервер вернул ошибку.
    private static let topAnchor = "profile.edit.top"

    private var role: Role { viewer.profile?.role.flatMap(Role.init(rawValue:)) ?? .unknown }
    private var isStudent: Bool { role == .student || role == .starosta }
    private var hasChanges: Bool { loadedID != nil && form != original }
    private var isValid: Bool { firstNameError == nil && lastNameError == nil && form.websiteIsValid }
    private var canSave: Bool { hasChanges && isValid && !isSaving && uploading == nil }

    private var firstNameError: String? { requiredError(form.firstName) }
    private var lastNameError: String? { requiredError(form.lastName) }

    /// Пустое обязательное поле видно сразу у поля, а не только по серой «Сохранить».
    private func requiredError(_ value: String) -> String? {
        guard loadedID != nil, value.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return String(localized: "profile.required", defaultValue: "Заполните поле")
    }

    /// Порядок полей для «Далее» и стрелок над клавиатурой — как на экране.
    private var fieldOrder: [Field] {
        var order: [Field] = [.lastName, .firstName, .middleName, .headline, .bio, .phone, .telegram]
        if isStudent { order.append(.instagram) }
        if role.isAcademic { order.append(.website) }
        if role == .teacher { order += [.department, .officeRoom, .officeHours] }
        if isStudent { order.append(.skill) }
        return order
    }

    var body: some View {
        ScrollViewReader { scroller in
            Form {
                // Якорь прокрутки — сама ошибка, а не пустая строка над формой: строка
                // нулевой высоты в сгруппированной форме всё равно занимает минимальную
                // высоту строки и давала лишнюю полосу под панелью.
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                        .id(Self.topAnchor)
                }
                headerSection
                personalSection
                aboutSection
                contactsSection
                if role == .teacher { workSection }
                if isStudent { skillsSection }
            }
            .onChange(of: failure) { _, message in
                guard message != nil else { return }
                // Строка ошибки появляется в этом же проходе — прокрутка к ней после него.
                Task { @MainActor in
                    withMotion(Motion.calm) { scroller.scrollTo(Self.topAnchor, anchor: .top) }
                }
            }
        }
        .listSectionSpacing(.compact)
        .contentMargins(.top, Spacing.sm, for: .scrollContent)
        .scrollDismissesKeyboard(.interactively)
        .softTopEdge()
        .navigationTitle(Text(String(localized: "profile.editTitle.short", defaultValue: "Редактирование")))
        .navigationBarTitleDisplayMode(.inline)
        // Свайп назад и системная «Назад» уходят молча — пока есть что терять, их
        // заменяет своя кнопка с вопросом.
        .navigationBarBackButtonHidden(hasChanges || isSaving)
        .toolbar { toolbar }
        .alert(
            String(localized: "profile.edit.exitTitle", defaultValue: "Сохранить изменения?"),
            isPresented: $confirmingExit
        ) {
            Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                Task { await save() }
            }
            .disabled(!isValid)
            Button(String(localized: "form.discard", defaultValue: "Не сохранять"), role: .destructive) {
                dismiss()
            }
            Button(String(localized: "form.keepEditing", defaultValue: "Продолжить редактирование"), role: .cancel) {}
        }
        .photosPicker(isPresented: $pickingAvatar, selection: $avatarItem, matching: .images)
        .photosPicker(isPresented: $pickingCover, selection: $coverItem, matching: .images)
        .onChange(of: avatarItem) { Task { await upload(.avatar) } }
        .onChange(of: coverItem) { Task { await upload(.cover) } }
        .fullScreenCover(isPresented: Binding(get: { shooting != nil }, set: { if !$0 { shooting = nil } })) {
            if let kind = shooting {
                CameraPicker { image in
                    Task { await upload(kind, image: image) }
                }
                .ignoresSafeArea()
            }
        }
        .fullScreenCover(isPresented: Binding(get: { viewing != nil }, set: { if !$0 { viewing = nil } })) {
            if let kind = viewing, let url = kind == .avatar ? viewer.profile?.avatarUrl : viewer.profile?.coverUrl {
                MediaViewer(media: [PostDTO.Media(id: "profile-\(kind)", url: url, mime: "image/jpeg", sources: nil, poster: nil, hls: nil)], start: 0)
            }
        }
        .sensoryFeedback(.error, trigger: failure) { _, new in new != nil }
        .task {
            if viewer.profile == nil { await viewer.refresh() }
            fill()
        }
    }

    // MARK: Панель

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if hasChanges || isSaving {
            ToolbarItem(placement: .topBarLeading) {
                NavigationBackButton {
                    focused = nil
                    confirmingExit = true
                }
                .disabled(isSaving)
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button {
                Task { await save() }
            } label: {
                if isSaving {
                    ProgressView()
                } else {
                    Text(String(localized: "common.save", defaultValue: "Сохранить"))
                }
            }
            .disabled(!canSave)
            .accessibilityLabel(Text(String(localized: "common.save", defaultValue: "Сохранить")))
            .accessibilityIdentifier("profile.save")
        }
        // Над клавиатурой: соседние поля и «Готово» — у цифровой клавиатуры телефона
        // своей кнопки ввода нет вовсе.
        ToolbarItemGroup(placement: .keyboard) {
            Button {
                move(by: -1)
            } label: {
                Image(systemName: "chevron.up")
            }
            .disabled(neighbour(of: focused, by: -1) == nil)
            .accessibilityLabel(Text(String(localized: "form.prevField", defaultValue: "Предыдущее поле")))
            Button {
                move(by: 1)
            } label: {
                Image(systemName: "chevron.down")
            }
            .disabled(neighbour(of: focused, by: 1) == nil)
            .accessibilityLabel(Text(String(localized: "form.nextField", defaultValue: "Следующее поле")))
            Spacer()
            Button(String(localized: "common.done", defaultValue: "Готово")) { focused = nil }
        }
    }

    private func neighbour(of field: Field?, by step: Int) -> Field? {
        guard let field, let index = fieldOrder.firstIndex(of: field) else { return nil }
        let next = index + step
        return fieldOrder.indices.contains(next) ? fieldOrder[next] : nil
    }

    private func move(by step: Int) {
        if let next = neighbour(of: focused, by: step) { focused = next }
    }

    // MARK: Фото и обложка

    /// Фото по центру и под ним «Сменить фото», как правка профиля в Telegram, — но
    /// компактно: экран про поля, а не про аватар.
    private var avatarSide: CGFloat { min(avatarSize, 112) }
    private let coverHeight: CGFloat = 112

    /// Обложка и фото — как в шапке профиля: аватар наполовину на обложке, и видно,
    /// как профиль будет выглядеть. Касание открывает меню действий прямо у снимка
    /// (галерея, камера, просмотр, удаление); значок карандаша подсказывает, что на
    /// снимок можно нажать. Отдельной кнопки «Сменить фото» нет — меню у самого фото.
    private var headerSection: some View {
        Section {
            ZStack(alignment: .bottom) {
                Button { coverActions = true } label: {
                    coverPreview
                        .overlay(alignment: .topTrailing) { EditBadge().padding(Spacing.md) }
                }
                .buttonStyle(.pressable)
                .padding(.bottom, avatarSide / 2)
                .accessibilityLabel(Text(viewer.profile?.coverUrl == nil
                    ? String(localized: "profile.addCover", defaultValue: "Добавить обложку")
                    : String(localized: "profile.changeCover", defaultValue: "Сменить обложку")))
                .confirmationDialog(Text(verbatim: ""), isPresented: $coverActions, titleVisibility: .hidden) {
                    photoActions(.cover)
                }
                Button { avatarActions = true } label: {
                    avatarPreview
                        .overlay(alignment: .bottomTrailing) { EditBadge() }
                }
                .buttonStyle(.pressable)
                .accessibilityLabel(Text(String(localized: "profile.changeAvatar", defaultValue: "Сменить фото")))
                .confirmationDialog(Text(verbatim: ""), isPresented: $avatarActions, titleVisibility: .hidden) {
                    photoActions(.avatar)
                }
            }
            .disabled(uploading != nil)
            .padding(.bottom, Spacing.sm)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    /// Действия над фото или обложкой. Удаление красное и отдельной строкой — второе
    /// подтверждение поверх меню было бы лишним.
    @ViewBuilder
    private func photoActions(_ kind: Upload) -> some View {
        let exists = kind == .avatar ? viewer.profile?.avatarUrl != nil : viewer.profile?.coverUrl != nil
        Button(String(localized: "profile.photo.library", defaultValue: "Выбрать из галереи")) {
            if kind == .avatar { pickingAvatar = true } else { pickingCover = true }
        }
        if CameraPicker.isAvailable {
            Button(String(localized: "profile.photo.camera", defaultValue: "Сделать фото")) {
                shooting = kind
            }
        }
        if exists {
            Button(String(localized: "profile.photo.view", defaultValue: "Посмотреть")) {
                viewing = kind
            }
            Button(kind == .avatar
                ? String(localized: "profile.removeAvatar", defaultValue: "Удалить фото")
                : String(localized: "profile.removeCover", defaultValue: "Удалить обложку"), role: .destructive) {
                Task { await remove(kind) }
            }
        }
    }

    private var coverPreview: some View {
        ZStack {
            if let url = viewer.profile?.coverUrl.flatMap(URL.init(string:)) {
                RemoteImage(url: url, cacheKey: "cover:\(viewer.profile?.coverUrl?.split(separator: "?").first ?? "")")
            } else {
                Palette.card
                Label(String(localized: "profile.addCover", defaultValue: "Добавить обложку"), systemImage: "photo")
                    .font(Typography.meta.weight(.medium))
                    .foregroundStyle(Palette.mutedForeground)
                    // Подпись — в верхней половине: нижнюю закрывает аватар.
                    .padding(.bottom, avatarSide / 2)
            }
            if uploading == .cover {
                Color.black.opacity(0.35)
                ProgressView().tint(.white)
            }
        }
        .frame(height: coverHeight)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private var avatarPreview: some View {
        ZStack {
            AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: avatarSide)
            if uploading == .avatar {
                Circle().fill(.black.opacity(0.35))
                ProgressView().tint(.white)
            }
        }
        .frame(width: avatarSide, height: avatarSide)
        .overlay(Circle().strokeBorder(Palette.background, lineWidth: 4))
    }

    // MARK: Поля

    private var personalSection: some View {
        Section {
            LabeledFormField(title: String(localized: "profile.lastName", defaultValue: "Фамилия"), error: lastNameError) {
                TextField(text: $form.lastName) { Text(String(localized: "profile.lastName", defaultValue: "Фамилия")) }
                    .textContentType(.familyName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                    .focused($focused, equals: .lastName)
                    .onSubmit { move(by: 1) }
            }
            LabeledFormField(title: String(localized: "profile.firstName", defaultValue: "Имя"), error: firstNameError) {
                TextField(text: $form.firstName) { Text(String(localized: "profile.firstName", defaultValue: "Имя")) }
                    .textContentType(.givenName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                    .focused($focused, equals: .firstName)
                    .onSubmit { move(by: 1) }
            }
            LabeledFormField(title: String(localized: "profile.middleName", defaultValue: "Отчество")) {
                TextField(text: $form.middleName) { Text(String(localized: "profile.middleName", defaultValue: "Отчество")) }
                    .textContentType(.middleName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                    .focused($focused, equals: .middleName)
                    .onSubmit { move(by: 1) }
            }
        } header: {
            Text(String(localized: "profile.personal", defaultValue: "Личные данные"))
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledFormField(title: String(localized: "profile.headline", defaultValue: "Строка под именем")) {
                TextField(
                    text: $form.headline,
                    prompt: Text(String(localized: "profile.headline.prompt", defaultValue: "Коротко о главном"))
                ) {
                    Text(String(localized: "profile.headline", defaultValue: "Строка под именем"))
                }
                .submitLabel(.next)
                .focused($focused, equals: .headline)
                .onSubmit { move(by: 1) }
            }
            // Многострочное поле растёт с текстом: от трёх строк, дальше прокручивается
            // само, а не раздувает форму. «Ввод» — новая строка, к следующему полю ведут
            // стрелки над клавиатурой.
            LabeledFormField(title: String(localized: "profile.bio", defaultValue: "О себе")) {
                TextField(
                    text: $form.bio,
                    prompt: Text(String(localized: "profile.bio.prompt", defaultValue: "Пара слов о себе")),
                    axis: .vertical
                ) {
                    Text(String(localized: "profile.bio", defaultValue: "О себе"))
                }
                .lineLimit(3...10)
                .focused($focused, equals: .bio)
            }
        } header: {
            Text(String(localized: "profile.about", defaultValue: "О себе"))
        }
    }

    private var contactsSection: some View {
        Section {
            LabeledFormField(title: String(localized: "profile.phone", defaultValue: "Телефон")) {
                TextField(text: $form.phone, prompt: Text(verbatim: "+7 700 000 00 00")) {
                    Text(String(localized: "profile.phone", defaultValue: "Телефон"))
                }
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .focused($focused, equals: .phone)
            }
            LabeledFormField(title: String(localized: "profile.telegram", defaultValue: "Telegram (без @)")) {
                TextField(text: $form.telegram, prompt: Text(verbatim: "username")) {
                    Text(String(localized: "profile.telegram", defaultValue: "Telegram (без @)"))
                }
                .keyboardType(.asciiCapable)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focused, equals: .telegram)
                .onSubmit { move(by: 1) }
            }
            if isStudent {
                LabeledFormField(title: String(localized: "profile.instagram", defaultValue: "Instagram (без @)")) {
                    TextField(text: $form.instagram, prompt: Text(verbatim: "username")) {
                        Text(String(localized: "profile.instagram", defaultValue: "Instagram (без @)"))
                    }
                    .keyboardType(.asciiCapable)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focused, equals: .instagram)
                    .onSubmit { move(by: 1) }
                }
            }
            // Сайт сервер хранит только у студента, старосты и преподавателя
            // (`ProfileForm.update`): у остальных поле молча теряло бы ввод.
            if role.isAcademic {
                LabeledFormField(
                    title: String(localized: "profile.website", defaultValue: "Сайт"),
                    error: form.websiteIsValid
                        ? nil
                        : String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://")
                ) {
                    TextField(text: $form.website, prompt: Text(verbatim: "https://")) {
                        Text(String(localized: "profile.website", defaultValue: "Сайт"))
                    }
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focused, equals: .website)
                    .onSubmit { move(by: 1) }
                }
            }
        } header: {
            Text(String(localized: "profile.contacts", defaultValue: "Контакты"))
        } footer: {
            Text(String(localized: "profile.contacts.footer", defaultValue: "Кто видит почту и телефон — в «Настройки → Конфиденциальность»."))
        }
    }

    private var workSection: some View {
        Section {
            LabeledFormField(title: String(localized: "profile.department", defaultValue: "Кафедра")) {
                TextField(text: $form.department) { Text(String(localized: "profile.department", defaultValue: "Кафедра")) }
                    .submitLabel(.next)
                    .focused($focused, equals: .department)
                    .onSubmit { move(by: 1) }
            }
            LabeledFormField(title: String(localized: "profile.officeRoom", defaultValue: "Кабинет")) {
                TextField(text: $form.officeRoom) { Text(String(localized: "profile.officeRoom", defaultValue: "Кабинет")) }
                    .submitLabel(.next)
                    .focused($focused, equals: .officeRoom)
                    .onSubmit { move(by: 1) }
            }
            LabeledFormField(title: String(localized: "profile.officeHours", defaultValue: "Часы приёма")) {
                TextField(text: $form.officeHours) { Text(String(localized: "profile.officeHours", defaultValue: "Часы приёма")) }
                    .submitLabel(.done)
                    .focused($focused, equals: .officeHours)
                    .onSubmit { focused = nil }
            }
        } header: {
            Text(String(localized: "profile.work", defaultValue: "Работа"))
        }
    }

    private var skillsSection: some View {
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
                        .font(.title3)
                        .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                }
                .buttonStyle(.borderless)
                .disabled(newSkill.trimmingCharacters(in: .whitespaces).isEmpty || form.skills.count >= 30)
                .accessibilityLabel(Text(String(localized: "profile.skills.add", defaultValue: "Добавить навык")))
            }
        } header: {
            Text(String(localized: "profile.skills", defaultValue: "Навыки"))
        } footer: {
            Text(String(localized: "profile.skills.footer", defaultValue: "До 30 навыков. Смахните влево, чтобы удалить."))
        }
    }

    /// Форму заполняем один раз: повторный показ экрана и обновление профиля после
    /// загрузки фото не должны стирать набранное.
    private func fill() {
        guard let profile = viewer.profile, loadedID != profile.id else { return }
        loadedID = profile.id
        form = ProfileForm(profile)
        original = form
    }

    private func addSkill() {
        let skill = newSkill.trimmingCharacters(in: .whitespaces)
        guard !skill.isEmpty, skill.count <= 60, !form.skills.contains(skill), form.skills.count < 30 else { return }
        form.skills.append(skill)
        newSkill = ""
    }

    /// Сохранение. Ответ сервера сразу становится профилем всего приложения
    /// (`viewer.adopt`) — шапка профиля и настройки обновляются без нового запроса.
    @MainActor
    private func save() async {
        guard hasChanges, isValid, !isSaving, uploading == nil else { return }
        focused = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await api.updateProfile(form.update(role: role))
            viewer.adopt(updated)
            original = form
            failure = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
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
            try await send(kind, image: UIImage(data: data))
        } catch {
            failure = error.userMessage
        }
    }

    /// Снимок с камеры — тем же путём, что выбранный в галерее.
    @MainActor
    private func upload(_ kind: Upload, image: UIImage) async {
        uploading = kind
        defer { uploading = nil }
        do {
            try await send(kind, image: image)
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func send(_ kind: Upload, image: UIImage?) async throws {
        let jpeg = await PhotoJPEG.encode(image, maxSide: kind == .avatar ? PhotoJPEG.avatarSide : 2048)
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
}

/// Поле формы с постоянной подписью сверху. Подсказка внутри поля пропадает, как только
/// в нём есть текст, — подпись остаётся, и заполненная форма читается без догадок.
/// VoiceOver читает подпись самого поля (ярлык `TextField`), а не эту строку.
private struct LabeledFormField<Input: View>: View {
    let title: String
    var error: String?
    @ViewBuilder var input: () -> Input

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(Typography.meta)
                .foregroundStyle(error == nil ? Palette.mutedForeground : Palette.destructive)
                .accessibilityHidden(true)
            input()
                .font(Typography.body)
                .accessibilityHint(Text(verbatim: error ?? ""))
            if let error {
                Text(error)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, Spacing.xs)
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
