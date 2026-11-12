import Contacts
import ContactsUI
import PDFKit
import SwiftUI
import UIKit
import VisionKit

// MARK: - Контакт

/// Системный выбор контакта. Доступа ко всей телефонной книге приложение не получает:
/// система отдаёт только тот контакт, который человек выбрал сам (с поиском по книге).
struct ContactPicker: UIViewControllerRepresentable {
    let onPick: (CNContact) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick, onCancel: onCancel) }

    func makeUIViewController(context: Context) -> CNContactPickerViewController {
        let picker = CNContactPickerViewController()
        picker.delegate = context.coordinator
        picker.displayedPropertyKeys = [CNContactPhoneNumbersKey, CNContactEmailAddressesKey]
        // Контакт без телефона и почты отправлять бессмысленно.
        picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0 OR emailAddresses.@count > 0")
        return picker
    }

    func updateUIViewController(_ controller: CNContactPickerViewController, context: Context) {}

    final class Coordinator: NSObject, CNContactPickerDelegate {
        let onPick: (CNContact) -> Void
        let onCancel: () -> Void

        init(onPick: @escaping (CNContact) -> Void, onCancel: @escaping () -> Void) {
            self.onPick = onPick
            self.onCancel = onCancel
        }

        func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
            onPick(contact)
        }

        func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
            onCancel()
        }
    }
}

extension ContactCardDraft: Identifiable {
    var id: String { ([name] + phones + emails).joined(separator: "|") }
}

extension ContactCardDraft {
    /// Карточка из контакта: имя, до пяти телефонов и адресов почты (предел сервера).
    init?(_ contact: CNContact) {
        let name = CNContactFormatter.string(from: contact, style: .fullName)
            ?? [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        let phones = contact.phoneNumbers.map(\.value.stringValue).filter { !$0.isEmpty }.prefix(5).map { String($0.prefix(40)) }
        let emails = contact.emailAddresses.map { $0.value as String }.filter { !$0.isEmpty }.prefix(5).map { String($0.prefix(200)) }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !(phones.isEmpty && emails.isEmpty) else { return nil }
        self.init(
            name: String((trimmed.isEmpty ? (phones.first ?? emails.first ?? "") : trimmed).prefix(200)),
            phones: Array(phones),
            emails: Array(emails)
        )
    }
}

/// Подтверждение перед отправкой контакта: что именно уйдёт в чат.
struct ContactConfirmSheet: View {
    let contact: ContactCardDraft
    let onSend: () async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var isSending = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: Spacing.lg) {
                        AvatarView(url: nil, name: contact.name, size: 52)
                        Text(contact.name)
                            .font(Typography.body.weight(.semibold))
                    }
                }
                if !contact.phones.isEmpty {
                    Section(String(localized: "chats.contact.phones", defaultValue: "Телефон")) {
                        ForEach(contact.phones, id: \.self) { Text($0) }
                    }
                }
                if !contact.emails.isEmpty {
                    Section(String(localized: "chats.contact.emails", defaultValue: "Почта")) {
                        ForEach(contact.emails, id: \.self) { Text($0) }
                    }
                }
            }
            .navigationTitle(Text(String(localized: "chats.contact.title", defaultValue: "Контакт")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button(String(localized: "chats.send", defaultValue: "Отправить")) {
                            Task {
                                isSending = true
                                let ok = await onSend()
                                isSending = false
                                if ok { dismiss() }
                            }
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Скан документа

/// Системный сканер документов: страницы склеиваются в один PDF и уходят файлом.
struct DocumentScanner: UIViewControllerRepresentable {
    let onScan: (URL) -> Void
    let onCancel: () -> Void

    static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan, onCancel: onCancel) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: (URL) -> Void
        let onCancel: () -> Void

        init(onScan: @escaping (URL) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan
            self.onCancel = onCancel
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let document = PDFDocument()
            for index in 0..<scan.pageCount {
                if let page = PDFPage(image: scan.imageOfPage(at: index)) {
                    document.insert(page, at: document.pageCount)
                }
            }
            let name = String(
                localized: "chats.scan.fileName",
                defaultValue: "Скан \(Date().formatted(date: .numeric, time: .shortened))"
            )
            .replacingOccurrences(of: "/", with: ".")
            .replacingOccurrences(of: ":", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).pdf")
            if document.write(to: url) {
                onScan(url)
            } else {
                onCancel()
            }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onCancel()
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onCancel()
        }
    }
}
