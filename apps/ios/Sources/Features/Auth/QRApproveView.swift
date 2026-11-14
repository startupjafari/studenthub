import SwiftUI
import UIKit

/// Подтверждение входа на компьютере.
///
/// Экран живёт за входом: подтвердить чужой вход может только тот, кто сам вошёл.
/// Порядок шагов повторяет страницу `/qr` в вебе — сканирование, предупреждение,
/// подтверждение, — потому что это одна и та же операция с одними последствиями.
///
/// Открывается на весь экран: пока идёт сканирование, камера занимает его целиком, от
/// края до края, а поверх — как у системного сканера кодов: затемнение вокруг рамки,
/// короткая подсказка, фонарик и два коротких пункта «откуда код и чего остерегаться».
struct QRApproveView: View {
    @State private var model = QRApproveModel()
    @State private var torchOn = false
    @State private var hasTorch = false
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
                    // Над камерой крестик белый: синий на тёмной картинке терялся.
                    closeButton
                        .tint(isScanning ? .white : nil)
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

    /// Камера на весь экран, поверх — как у системного сканера кодов: всё вокруг рамки
    /// притемнено, и видно, куда держать код; под рамкой — подсказка в капсуле; внизу —
    /// фонарик и два коротких пункта. Рамка поднята: держать телефон, глядя в верхнюю
    /// часть экрана, естественнее. Распознаётся код в любом месте кадра — рамка лишь
    /// подсказывает, куда навести.
    private var scanning: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width - Spacing.xxl * 4, 260)
            let hole = CGRect(
                x: (proxy.size.width - side) / 2,
                y: proxy.size.height * 0.38 - side / 2,
                width: side,
                height: side
            )
            ZStack(alignment: .topLeading) {
                QRScannerView(
                    onScan: { payload in Task { await model.scanned(payload) } },
                    onUnavailable: { model.cameraUnavailable() },
                    torchOn: torchOn,
                    onTorchAvailable: { hasTorch = $0 }
                )
                .accessibilityLabel(Text(String(
                    localized: "auth.qrScannerLabel",
                    defaultValue: "Видоискатель камеры"
                )))

                ScannerDimming(hole: hole, radius: 30)
                    .fill(.black.opacity(0.5), style: FillStyle(eoFill: true))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

                ViewfinderCorners(length: 40, radius: 30)
                    .stroke(.white, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                    .frame(width: side + 6, height: side + 6)
                    .position(x: hole.midX, y: hole.midY)
                    .accessibilityHidden(true)

                Text(String(
                    localized: "auth.qrScanHint",
                    defaultValue: "Наведите камеру на QR-код на экране компьютера"
                ))
                .font(Typography.meta.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .background { scannerGlass(Capsule()) }
                .environment(\.colorScheme, .dark)
                .frame(maxWidth: proxy.size.width - Spacing.xxl * 2)
                .position(x: hole.midX, y: hole.maxY + Spacing.xxl + Spacing.md)

                VStack(spacing: Spacing.lg) {
                    if hasTorch { torchButton }
                    scanTips
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, proxy.safeAreaInsets.bottom + Spacing.lg)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)
            }
        }
        .ignoresSafeArea()
        .sensoryFeedback(.selection, trigger: torchOn)
    }

    /// Фонарик — круглой кнопкой из стекла, как в системной камере: в полутьме экран
    /// компьютера бликует, и код читается хуже.
    private var torchButton: some View {
        Button {
            torchOn.toggle()
        } label: {
            Image(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(torchOn ? .black : .white)
                .frame(width: 58, height: 58)
                .background {
                    if torchOn {
                        Circle().fill(.white)
                    } else {
                        scannerGlass(Circle())
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.pressable)
        .environment(\.colorScheme, .dark)
        .accessibilityLabel(Text(String(localized: "auth.qrTorch", defaultValue: "Фонарик")))
        .accessibilityAddTraits(torchOn ? .isSelected : [])
    }

    /// Откуда взять код и чего остерегаться — двумя короткими строками. Главный риск —
    /// отсканировать чужой код, присланный в сообщении, — назван до шага подтверждения.
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
                symbol: "exclamationmark.shield",
                text: String(
                    localized: "auth.qrTipSafety",
                    defaultValue: "Сканируйте только код со своего экрана — не из сообщений и писем"
                )
            )
        }
        .frame(maxWidth: 480, alignment: .leading)
        .padding(Spacing.lg)
        .background { scannerGlass(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)) }
        // Над тёмной картинкой камеры: текст и стекло — в тёмном варианте при любой теме.
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .combine)
    }

    /// Стекло на iOS 26, раньше — материал. Стекло притемнено: за ним бывает белый экран
    /// компьютера, и светлый текст на прозрачном стекле над ним терялся бы.
    @ViewBuilder
    private func scannerGlass<S: Shape>(_ shape: S) -> some View {
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

/// Затемнение вокруг рамки: весь экран, кроме скруглённого квадрата рамки (заливка
/// «чёт-нечет»), — как у системного сканера кодов.
private struct ScannerDimming: Shape {
    let hole: CGRect
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRoundedRect(in: hole, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
        return path
    }
}

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
