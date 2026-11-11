import PhotosUI
import SwiftUI
import UIKit

// Общее для правки фото: аватар профиля, обложка, фото группы. Меню источника, значок
// «можно изменить» и сжатие перед загрузкой были бы в каждом экране своими — и
// расходились бы в мелочах (размер, качество, набор пунктов).

/// Значок «можно изменить» поверх фото и обложки в редакторе.
struct EditBadge: View {
    var body: some View {
        Image(systemName: "pencil")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .frame(width: 26, height: 26)
            .background(Palette.primary, in: Circle())
            .overlay(Circle().strokeBorder(Palette.background, lineWidth: 2))
            .accessibilityHidden(true)
    }
}

/// Снимок для загрузки: уменьшенный JPEG.
enum PhotoJPEG {
    /// Длинная сторона аватара — сервер всё равно хранит уменьшенную копию.
    static let avatarSide: CGFloat = 1024

    /// Сжимаем на устройстве: фото камеры весит больше лимита в 10 МБ. Работа тяжёлая
    /// для главного потока, поэтому — в фоне.
    static func encode(_ image: UIImage?, maxSide: CGFloat) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            image.flatMap { downscaled($0, maxSide: maxSide).jpegData(compressionQuality: 0.85) }
        }.value
    }

    private static func downscaled(_ image: UIImage, maxSide: CGFloat) -> UIImage {
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

extension View {
    /// Меню источника фото у самого снимка: галерея, камера (если есть) и, когда фото уже
    /// стоит, «Удалить фото». `pick` получает `nil`, если выбранное не читается как
    /// картинка, — сказать об этом решает экран.
    func photoSourceMenu(
        isPresented: Binding<Bool>,
        removable: Bool,
        pick: @escaping (UIImage?) -> Void,
        remove: @escaping () -> Void = {}
    ) -> some View {
        modifier(PhotoSourceMenu(isPresented: isPresented, removable: removable, pick: pick, remove: remove))
    }
}

private struct PhotoSourceMenu: ViewModifier {
    @Binding var isPresented: Bool
    let removable: Bool
    let pick: (UIImage?) -> Void
    let remove: () -> Void

    @State private var picking = false
    @State private var item: PhotosPickerItem?
    @State private var shooting = false

    func body(content: Content) -> some View {
        content
            // Привязано к снимку, а не к экрану: на iPad меню встаёт стрелкой у фото.
            // Удаление — красной строкой без второго подтверждения поверх меню.
            .confirmationDialog(Text(verbatim: ""), isPresented: $isPresented, titleVisibility: .hidden) {
                Button(String(localized: "profile.photo.library", defaultValue: "Выбрать из галереи")) {
                    picking = true
                }
                if CameraPicker.isAvailable {
                    Button(String(localized: "profile.photo.camera", defaultValue: "Сделать фото")) {
                        shooting = true
                    }
                }
                if removable {
                    Button(String(localized: "profile.removeAvatar", defaultValue: "Удалить фото"), role: .destructive) {
                        remove()
                    }
                }
            }
            .photosPicker(isPresented: $picking, selection: $item, matching: .images)
            .onChange(of: item) {
                guard let picked = item else { return }
                item = nil
                Task { @MainActor in
                    let data = try? await picked.loadTransferable(type: Data.self)
                    pick(data.flatMap(UIImage.init(data:)))
                }
            }
            .fullScreenCover(isPresented: $shooting) {
                CameraPicker { image in pick(image) }
                    .ignoresSafeArea()
            }
    }
}
