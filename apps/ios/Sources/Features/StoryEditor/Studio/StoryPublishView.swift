import AVKit
import SwiftUI

/// Последний шаг: кому показать и интерактив (ссылка, опрос, упоминания). Публикация —
/// только по кнопке: «Далее» в редакторе сюда лишь приводит.
struct StoryPublishView: View {
    let model: StoryStudioModel

    @State private var audience: StoryAudience = .group
    @State private var linkURL = ""
    @State private var linkLabel = ""
    @State private var pollOn = false
    @State private var pollQuestion = ""
    /// Варианты опроса со своими id: поле, привязанное к номеру, после удаления
    /// соседнего варианта указывало бы за конец массива.
    @State private var pollOptions = [StoryPollDraftOption(), StoryPollDraftOption()]
    @State private var mentions: [SearchResultsDTO.Person] = []
    @State private var pickingMention = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    previews
                    if let caption = model.document?.caption, !caption.isEmpty {
                        Text(caption)
                            .font(Typography.body)
                            .padding(Spacing.lg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
                    }
                    Picker(String(localized: "stories.audience", defaultValue: "Кому показать"), selection: $audience) {
                        ForEach(StoryAudience.allCases) { audience in
                            Text(audience.title).tag(audience)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("story.publish.audience")
                    interactive
                    if let failure = model.publishFailure {
                        FormAlert(message: failure)
                    }
                }
                .padding(Spacing.xl)
            }
            .background(Palette.background)
            .sheet(isPresented: $pickingMention) {
                CommunityPersonPicker(title: String(localized: "community.story.mention", defaultValue: "Упомянуть")) { person in
                    if !mentions.contains(where: { $0.id == person.id }), mentions.count < 10 { mentions.append(person) }
                }
            }
            .navigationTitle(Text(String(localized: "stories.new", defaultValue: "Новая история")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        model.backFromPublishing()
                    } label: {
                        Image(systemName: "chevron.backward")
                    }
                    .accessibilityLabel(Text(String(localized: "stories.publish.back", defaultValue: "Назад к редактору")))
                    .accessibilityIdentifier("story.publish.back")
                    .disabled(model.isPublishing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "stories.publish", defaultValue: "Опубликовать")) {
                        Task { await model.publish(audience: audience, extras: extras) }
                    }
                    .disabled(!canPublish)
                    .accessibilityIdentifier("story.publish.submit")
                }
            }
            .overlay {
                if model.isPublishing {
                    ProgressView().controlSize(.large)
                        .padding(Spacing.xxl)
                        .background(RoundedRectangle(cornerRadius: Radius.xl).fill(.regularMaterial))
                }
            }
            .interactiveDismissDisabled()
        }
        .accessibilityIdentifier("story.publish")
    }

    private var previews: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.md) {
                ForEach(Array(model.publishResults.enumerated()), id: \.offset) { _, result in
                    ZStack {
                        if let preview = result.preview {
                            Image(uiImage: preview).resizable().scaledToFill()
                        } else {
                            Palette.muted
                        }
                        if result.isVideo {
                            Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.white)
                        }
                    }
                    .frame(width: 150, height: 150 * 16 / 9)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                }
            }
        }
        .accessibilityIdentifier("story.publish.preview")
    }

    private var canPublish: Bool {
        !model.isPublishing && !model.publishResults.isEmpty && linkIsValid && pollIsValid
    }

    private var trimmedLink: String { linkURL.trimmingCharacters(in: .whitespaces) }
    private var linkIsValid: Bool {
        trimmedLink.isEmpty || ((trimmedLink.hasPrefix("https://") || trimmedLink.hasPrefix("http://")) && trimmedLink.count <= 500)
    }

    private var pollChoices: [String] {
        pollOptions.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var pollIsValid: Bool {
        guard pollOn else { return true }
        let question = pollQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        return !question.isEmpty && question.count <= 200 && pollChoices.count >= 2
            && Set(pollChoices).count == pollChoices.count && pollChoices.allSatisfy { $0.count <= 100 }
    }

    private var extras: CommunityStoryExtras {
        let label = linkLabel.trimmingCharacters(in: .whitespaces)
        // Упоминания встают столбиком у верхней трети кадра — двигать пальцем их пока нельзя.
        let placed = mentions.enumerated().map { index, person in
            CommunityStoryMentionInput(userId: person.id, x: 0.5, y: min(0.2 + Double(index) * 0.08, 0.9))
        }
        return CommunityStoryExtras(
            linkUrl: trimmedLink.isEmpty ? nil : trimmedLink,
            linkLabel: label.isEmpty ? nil : String(label.prefix(60)),
            poll: pollOn ? CommunityStoryPollInput(
                question: pollQuestion.trimmingCharacters(in: .whitespacesAndNewlines),
                options: pollChoices
            ) : nil,
            mentions: placed
        )
    }

    private var interactive: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(String(localized: "community.story.interactive", defaultValue: "Интерактив"))
                .font(Typography.sectionTitle)
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label(String(localized: "community.story.link", defaultValue: "Ссылка"), systemImage: "link")
                    .font(Typography.meta.weight(.semibold))
                TextField(String(localized: "community.story.linkURL", defaultValue: "https://…"), text: $linkURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !trimmedLink.isEmpty {
                    TextField(String(localized: "community.story.linkLabel", defaultValue: "Подпись ссылки (необязательно)"), text: $linkLabel)
                }
                if !linkIsValid {
                    FieldError(message: String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://"))
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))

            VStack(alignment: .leading, spacing: Spacing.md) {
                Toggle(isOn: $pollOn) {
                    Label(String(localized: "community.story.poll", defaultValue: "Опрос"), systemImage: "chart.bar")
                        .font(Typography.meta.weight(.semibold))
                }
                if pollOn {
                    TextField(String(localized: "community.story.pollQuestion", defaultValue: "Вопрос"), text: $pollQuestion)
                    ForEach($pollOptions) { $option in
                        let index = pollOptions.firstIndex { $0.id == option.id } ?? 0
                        HStack {
                            TextField(
                                String(localized: "community.story.pollOption", defaultValue: "Вариант \((index + 1).formatted())"),
                                text: $option.text
                            )
                            if pollOptions.count > 2 {
                                Button {
                                    pollOptions.removeAll { $0.id == option.id }
                                } label: {
                                    Image(systemName: "minus.circle").foregroundStyle(Palette.destructive)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text(String(localized: "community.story.removeOption", defaultValue: "Убрать вариант")))
                            }
                        }
                    }
                    if pollOptions.count < 4 {
                        Button {
                            pollOptions.append(StoryPollDraftOption())
                        } label: {
                            Label(String(localized: "community.story.addOption", defaultValue: "Добавить вариант"), systemImage: "plus")
                        }
                        .font(Typography.meta)
                    }
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))

            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Label(String(localized: "community.story.mentions", defaultValue: "Упоминания"), systemImage: "at")
                        .font(Typography.meta.weight(.semibold))
                    Spacer()
                    Button {
                        pickingMention = true
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .disabled(mentions.count >= 10)
                    .accessibilityLabel(Text(String(localized: "community.story.mention", defaultValue: "Упомянуть")))
                }
                ForEach(mentions) { person in
                    HStack {
                        Text(person.name).font(Typography.body)
                        Spacer()
                        Button {
                            mentions.removeAll { $0.id == person.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "community.story.removeMention", defaultValue: "Убрать упоминание")))
                    }
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
        }
    }
}

/// Вариант опроса в публикации истории.
struct StoryPollDraftOption: Identifiable {
    let id = UUID()
    var text = ""
}
