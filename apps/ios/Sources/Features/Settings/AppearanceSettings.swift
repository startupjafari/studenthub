import SwiftUI

/// Тема оформления. На сервере её нет (в вебе — тоже настройка устройства), поэтому
/// хранится локально: это удобство, а не данные человека.
enum AppearanceTheme: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let storageKey = "appearance.theme"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: return String(localized: "settings.theme.system", defaultValue: "Как в системе")
        case .light: return String(localized: "settings.theme.light", defaultValue: "Светлая")
        case .dark: return String(localized: "settings.theme.dark", defaultValue: "Тёмная")
        }
    }

    var symbol: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }

    var tint: Color {
        switch self {
        case .system: return TileTint.gray
        case .light: return TileTint.orange
        case .dark: return TileTint.indigo
        }
    }

    /// `nil` — не навязываем схему, приложение следует системе.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// Внешний вид: тема и язык интерфейса.
struct AppearanceSettingsView: View {
    @AppStorage(AppearanceTheme.storageKey) private var theme = AppearanceTheme.system.rawValue
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section {
                // Строки с цветными значками и галочкой у выбранной — как выбор темы в Telegram.
                ForEach(AppearanceTheme.allCases) { option in
                    Button {
                        theme = option.rawValue
                    } label: {
                        HStack {
                            IconRow(title: option.title, symbol: option.symbol + (option == .system ? "" : ".fill"), tint: option.tint)
                            if theme == option.rawValue {
                                Image(systemName: "checkmark")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Palette.primary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(theme == option.rawValue ? .isSelected : [])
                }
                .accessibilityIdentifier("settings.theme")
                .sensoryFeedback(.selection, trigger: theme)
            } header: {
                Text(String(localized: "settings.theme", defaultValue: "Тема"))
            }

            Section {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                } label: {
                    IconRow(
                        title: String(localized: "settings.language", defaultValue: "Язык приложения"),
                        symbol: "globe",
                        tint: TileTint.blue,
                        value: Locale.current.localizedString(forLanguageCode: Locale.current.language.languageCode?.identifier ?? "")?
                            .capitalized
                    )
                }
                .buttonStyle(.plain)
            } footer: {
                Text(String(
                    localized: "settings.language.footer",
                    defaultValue: "Язык меняется в настройках iPhone для приложения StudentHub. Язык писем и уведомлений — в разделе «Уведомления»."
                ))
            }
        }
        .settingsFormLayout()
        .hardTopEdge()
        .navigationTitle(Text(String(localized: "settings.appearance", defaultValue: "Внешний вид")))
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension View {
    /// Тема из настроек — на корень приложения: листы и полноэкранные окна её наследуют.
    func appearanceTheme(_ raw: String) -> some View {
        preferredColorScheme(AppearanceTheme(rawValue: raw)?.colorScheme)
    }
}
