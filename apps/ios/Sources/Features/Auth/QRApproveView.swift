import SwiftUI
import UIKit

/// Подтверждение входа на компьютере.
///
/// Экран живёт за входом: подтвердить чужой вход может только тот, кто сам вошёл.
/// Порядок шагов повторяет страницу `/qr` в вебе — сканирование, предупреждение,
/// подтверждение, — потому что это одна и та же операция с одними последствиями.
///
/// Открывается на весь экран: пока идёт сканирование, камера занимает его целиком, от
/// края до края, а поверх — только уголки рамки, куда навести код, и подсказка.
struct QRApproveView: View {
    @State private var model = QRApproveModel()
    @Environment(\.dismiss) private var dismiss

    private var isScanning: Bool {
        if case .scanning = model.state { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Group {
                if isScanning {
                    scanning
                } else {
                    content
                        .padding(Spacing.xl)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.background)
                }
            }
            // Над камерой панель светлая: заголовок и «Закрыть» читаются на тёмной
            // картинке.
            .toolbarColorScheme(isScanning ? .dark : nil, for: .navigationBar)
            .navigationTitle(Text(String(
                localized: "auth.qrApproveTitle",
                defaultValue: "Вход на другом устройстве"
            )))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    closeButton
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
        case .previewing:
            waiting(String(localized: "auth.qrPreviewing", defaultValue: "Проверяем код…"))
        case .confirming(_, let preview):
            confirmation(preview)
        case .approving:
            waiting(String(localized: "auth.qrApproving", defaultValue: "Подтверждаем…"))
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

    /// «Закрыть»: на iOS 26 — системный крестик в стекле, как у листов приложения
    /// (`SheetCloseButton`); раньше — слово. Не `SheetCloseButton` сам: его запасной
    /// вариант — «Отмена», а после подтверждения входа отменять уже нечего.
    @ViewBuilder
    private var closeButton: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Button(role: .close, action: { dismiss() })
                    .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
            } else {
                legacyCloseButton
            }
        #else
            legacyCloseButton
        #endif
    }

    private var legacyCloseButton: some View {
        Button {
            dismiss()
        } label: {
            Text(String(localized: "common.close", defaultValue: "Закрыть"))
        }
    }

    /// Камера на весь экран, поверх — уголки рамки в верхней части и подсказка под ними,
    /// внизу — карточка «когда это нужно». Рамка поднята: держать телефон, глядя в
    /// верхнюю треть экрана, естественнее, а низ занимает объяснение. Рамка — подсказка,
    /// куда держать код; распознаётся он в любом месте кадра.
    private var scanning: some View {
        QRScannerView(
            onScan: { payload in Task { await model.scanned(payload) } },
            onUnavailable: { model.cameraUnavailable() }
        )
        .ignoresSafeArea()
        .accessibilityLabel(Text(String(
            localized: "auth.qrScannerLabel",
            defaultValue: "Видоискатель камеры"
        )))
        .overlay {
            VStack(spacing: Spacing.xl) {
                ViewfinderCorners()
                    .stroke(.white, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                    // До 240 pt, а на низком экране — меньше: карточка внизу не должна
                    // наезжать на рамку. Приоритет — чтобы распорка ниже не отъедала у
                    // рамки место, пока его хватает обеим.
                    .aspectRatio(1, contentMode: .fit)
                    .frame(maxWidth: 240, maxHeight: 240)
                    .shadow(color: .black.opacity(0.4), radius: 4)
                    .layoutPriority(1)
                    .accessibilityHidden(true)
                Text(String(
                    localized: "auth.qrScanHint",
                    defaultValue: "Наведите камеру на QR-код на экране компьютера"
                ))
                .font(Typography.body.weight(.medium))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .shadow(color: .black.opacity(0.5), radius: 4)
                .padding(.horizontal, Spacing.xxl)
                Spacer(minLength: Spacing.xl)
                scanTips
            }
            .padding(.top, Spacing.xxl)
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xl)
        }
    }

    /// Когда этим пользоваться и чего остерегаться — коротко, поверх камеры. Без этого
    /// экран выглядел как сканер «чего угодно», а главный риск — отсканировать чужой
    /// код, присланный в сообщении, — оставался неназванным до шага подтверждения.
    private var scanTips: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            scanTip(
                symbol: "desktopcomputer",
                text: String(
                    localized: "auth.qrTipOpen",
                    defaultValue: "Откройте StudentHub на компьютере и выберите вход по QR-коду"
                )
            )
            scanTip(
                symbol: "key",
                text: String(
                    localized: "auth.qrTipNoPassword",
                    defaultValue: "Удобно на новом или чужом компьютере — пароль вводить не нужно"
                )
            )
            scanTip(
                symbol: "exclamationmark.shield",
                text: String(
                    localized: "auth.qrTipSafety",
                    defaultValue: "Сканируйте только код со своего экрана — не из сообщений и писем"
                )
            )
        }
        .frame(maxWidth: 480, alignment: .leading)
        .padding(Spacing.lg)
        .background { scanTipsBackground }
        // Карточка над тёмной картинкой камеры: текст и стекло — в тёмном варианте при
        // любой теме приложения.
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .combine)
    }

    /// Стекло на iOS 26, раньше — материал. Стекло притемнено: за карточкой бывает
    /// белый экран компьютера, и светлый текст на прозрачном стекле над ним терялся бы.
    @ViewBuilder
    private var scanTipsBackground: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Color.clear.glassEffect(.regular.tint(.black.opacity(0.35)), in: shape)
            } else {
                shape.fill(.regularMaterial)
            }
        #else
            shape.fill(.regularMaterial)
        #endif
    }

    private func scanTip(symbol: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            Image(systemName: symbol)
                .font(Typography.meta.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text)
                .font(Typography.meta)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    private func confirmation(_ preview: QRLoginPreview) -> some View {
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

            requester(preview.requester)

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

    /// Кто просит вход: браузер и система компьютера, сеть. Человек сверяет это со
    /// своим компьютером — чужой QR выдаёт себя незнакомым браузером или адресом.
    private func requester(_ requester: QRLoginPreview.Requester) -> some View {
        let device = [requester.browser, requester.os]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(String(localized: "auth.qrRequester", defaultValue: "Кто просит вход"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            Text(device.isEmpty
                ? String(localized: "auth.qrUnknownDevice", defaultValue: "Неизвестное устройство")
                : device)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
            if let ip = requester.ip, !ip.isEmpty {
                Text(verbatim: ip)
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.lg)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private func waiting(_ text: String) -> some View {
        VStack(spacing: Spacing.lg) {
            ProgressView()
            Text(text)
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
                ManualTicketEntry { payload in Task { await model.scanned(payload) } }
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

/// Четыре скруглённых уголка квадрата — прицел сканера QR, как в системной камере.
private struct ViewfinderCorners: Shape {
    var length: CGFloat = 32
    var radius: CGFloat = 14

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let r = min(radius, length)
        // Левый верхний.
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + length))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        path.addQuadCurve(to: CGPoint(x: rect.minX + r, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX + length, y: rect.minY))
        // Правый верхний.
        path.move(to: CGPoint(x: rect.maxX - length, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + r), control: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + length))
        // Правый нижний.
        path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - length))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX - length, y: rect.maxY))
        // Левый нижний.
        path.move(to: CGPoint(x: rect.minX + length, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r), control: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - length))
        return path
    }
}
