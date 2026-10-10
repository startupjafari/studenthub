import SwiftUI
import UIKit

/// Подтверждение входа на компьютере.
///
/// Экран живёт за входом: подтвердить чужой вход может только тот, кто сам вошёл.
/// Порядок шагов повторяет страницу `/qr` в вебе — сканирование, предупреждение,
/// подтверждение, — потому что это одна и та же операция с одними последствиями.
struct QRApproveView: View {
    @State private var model = QRApproveModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .padding(Spacing.xl)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.background)
                .navigationTitle(Text(String(
                    localized: "auth.qrApproveTitle",
                    defaultValue: "Вход на другом устройстве"
                )))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            dismiss()
                        } label: {
                            Text(String(localized: "common.close", defaultValue: "Закрыть"))
                        }
                    }
                }
                .animation(Motion.calm, value: model.state)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .scanning:
            scanning
        case .confirming:
            confirmation
        case .approving:
            waiting
        case .approved:
            outcome(
                icon: "checkmark.circle.fill",
                tint: Palette.success,
                message: String(
                    localized: "auth.qrApproveDone",
                    defaultValue: "Готово! Вернитесь к компьютеру — вход выполнен."
                ),
                action: nil
            )
        case .rejected:
            outcome(
                icon: "xmark.circle.fill",
                tint: Palette.mutedForeground,
                message: String(localized: "auth.qrApproveRejected", defaultValue: "Вход отклонён."),
                action: nil
            )
        case .failed(let message):
            outcome(
                icon: "exclamationmark.triangle.fill",
                tint: Palette.destructive,
                message: message,
                action: (String(localized: "auth.qrScanAgain", defaultValue: "Сканировать снова"), { model.scanAgain() })
            )
        case .cameraUnavailable:
            cameraUnavailable
        }
    }

    private var scanning: some View {
        VStack(spacing: Spacing.xl) {
            QRScannerView(
                onScan: { payload in model.scanned(payload) },
                onUnavailable: { model.cameraUnavailable() }
            )
            .frame(maxWidth: .infinity)
            .frame(height: 320)
            .clipShape(RoundedRectangle(cornerRadius: Radius.xxl))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.xxl)
                    .strokeBorder(Palette.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(String(
                localized: "auth.qrScannerLabel",
                defaultValue: "Видоискатель камеры"
            )))

            Text(String(
                localized: "auth.qrScanHint",
                defaultValue: "Наведите камеру на QR-код на экране компьютера"
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)
        }
    }

    private var confirmation: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: "desktopcomputer")
                .font(.system(size: 36))
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)

            Text(String(
                localized: "auth.qrApprovePrompt",
                defaultValue: "Подтвердите вход в StudentHub на компьютере"
            ))
            .font(Typography.sectionTitle)
            .foregroundStyle(Palette.foreground)
            .multilineTextAlignment(.center)

            // Предупреждение — главная часть экрана, а не украшение: единственное,
            // что отделяет подтверждение своего входа от чужого, — внимание человека.
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(Palette.warning)
                    .accessibilityHidden(true)
                Text(String(
                    localized: "auth.qrApproveWarning",
                    defaultValue: """
                        Подтверждайте, только если вы сами начали вход на компьютере. \
                        Иначе кто-то другой получит доступ к вашему аккаунту.
                        """
                ))
                .font(Typography.meta)
                .foregroundStyle(Palette.foreground)
            }
            .padding(Spacing.lg)
            .background(Palette.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.xl))

            Button {
                Task { await model.approve() }
            } label: {
                Text(String(localized: "auth.qrApproveConfirm", defaultValue: "Подтвердить вход"))
            }
            .buttonStyle(PrimaryButtonStyle())

            Button {
                model.reject()
            } label: {
                Text(String(localized: "auth.qrApproveReject", defaultValue: "Отклонить"))
            }
            .buttonStyle(QuietButtonStyle())
        }
    }

    private var waiting: some View {
        VStack(spacing: Spacing.lg) {
            ProgressView()
            Text(String(localized: "auth.qrApproving", defaultValue: "Подтверждаем…"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        }
    }

    private var cameraUnavailable: some View {
        VStack(spacing: Spacing.xl) {
            Text(String(
                localized: "auth.qrCameraDenied",
                defaultValue: "Нет доступа к камере. Разрешите его в настройках, чтобы отсканировать код."
            ))
            .font(Typography.body)
            .foregroundStyle(Palette.foreground)
            .multilineTextAlignment(.center)

            Button {
                openSettings()
            } label: {
                Text(String(localized: "common.openSettings", defaultValue: "Открыть настройки"))
            }
            .buttonStyle(PrimaryButtonStyle())

            #if DEBUG
                ManualTicketEntry { payload in model.scanned(payload) }
            #endif
        }
    }

    private func outcome(
        icon: String,
        tint: Color,
        message: String,
        action: (String, () -> Void)?
    ) -> some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: icon)
                .font(.system(size: 36))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(message)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
            if let action {
                Button(action: action.1) {
                    Text(action.0)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            Button {
                dismiss()
            } label: {
                Text(String(localized: "common.done", defaultValue: "Готово"))
            }
            .buttonStyle(QuietButtonStyle())
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

#if DEBUG
    /// В симуляторе камеры нет, а экран проверять надо: ссылку из QR можно вставить
    /// руками. В релизную сборку не попадает.
    private struct ManualTicketEntry: View {
        let onSubmit: (String) -> Void
        @State private var link = ""

        var body: some View {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel(text: "Ссылка из QR (отладка)")
                TextField(text: $link) { Text(verbatim: "https://…/qr?t=…") }
                    .labelsHidden()
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .formField()
                Button {
                    onSubmit(link)
                } label: {
                    Text(verbatim: "Разобрать ссылку")
                }
                .buttonStyle(QuietButtonStyle())
            }
        }
    }
#endif
