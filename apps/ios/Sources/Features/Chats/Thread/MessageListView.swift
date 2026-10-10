import SwiftUI
import UIKit

/// Лента сообщений.
///
/// `UICollectionView` под SwiftUI-содержимым — решение плана: на тысячах ячеек с
/// удержанием позиции SwiftUI-список проседает, а ячейки всё равно рисует SwiftUI
/// через `UIHostingConfiguration`, так что пузыри остаются обычными вьюхами.
struct MessageListView: UIViewControllerRepresentable {
    let days: [MessageTimeline.Day]
    /// Куда прокрутить после применения среза.
    let anchor: String?
    let onReachTop: () -> Void
    let onRetry: (MessageRecord) -> Void
    let onReply: (MessageRecord) -> Void

    func makeUIViewController(context: Context) -> MessageListViewController {
        let controller = MessageListViewController()
        controller.onReachTop = onReachTop
        controller.onRetry = onRetry
        controller.onReply = onReply
        return controller
    }

    func updateUIViewController(_ controller: MessageListViewController, context: Context) {
        controller.onReachTop = onReachTop
        controller.onRetry = onRetry
        controller.onReply = onReply
        controller.apply(days: days, anchor: anchor)
    }
}

final class MessageListViewController: UIViewController {
    var onReachTop: (() -> Void)?
    var onRetry: ((MessageRecord) -> Void)?
    var onReply: ((MessageRecord) -> Void)?

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Date, String>!
    private var itemsByID: [String: MessageTimeline.Item] = [:]
    private var appliedAnchor: String?
    private var hasContent = false

    override func viewDidLoad() {
        super.viewDidLoad()
        configureCollectionView()
        configureDataSource()
    }

    /// Применить срез.
    ///
    /// Два правила, ради которых всё и написано руками. Первое: если человек стоит у
    /// нижнего края, новое сообщение подматывает ленту за ним. Второе: если сверху
    /// доехала страница старых сообщений, позиция не должна шевельнуться — поэтому
    /// после применения смещаем `contentOffset` ровно на выросшую высоту.
    func apply(days: [MessageTimeline.Day], anchor: String?) {
        itemsByID = Dictionary(
            uniqueKeysWithValues: days.flatMap(\.items).map { ($0.id, $0) }
        )

        var snapshot = NSDiffableDataSourceSnapshot<Date, String>()
        snapshot.appendSections(days.map(\.id))
        for day in days {
            snapshot.appendItems(day.items.map(\.id), toSection: day.id)
        }

        let wasAtBottom = isNearBottom
        let oldHeight = collectionView.contentSize.height
        let oldOffset = collectionView.contentOffset.y
        let isFirstFill = !hasContent && !days.isEmpty
        hasContent = hasContent || !days.isEmpty

        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }

            if isFirstFill, let anchor, anchor != self.appliedAnchor {
                self.appliedAnchor = anchor
                self.scroll(to: anchor)
                return
            }
            if isFirstFill || wasAtBottom {
                self.scrollToBottom(animated: !isFirstFill)
                return
            }
            let grown = self.collectionView.contentSize.height - oldHeight
            if grown > 0, oldOffset < grown {
                // Выросло сверху — компенсируем, иначе лента прыгнет под пальцем.
                self.collectionView.contentOffset.y = oldOffset + grown
            }
        }
    }

    // MARK: - Сборка

    private func configureCollectionView() {
        var layout = UICollectionLayoutListConfiguration(appearance: .plain)
        layout.showsSeparators = false
        layout.backgroundColor = .clear
        layout.headerMode = .supplementary

        collectionView = UICollectionView(
            frame: .zero,
            collectionViewLayout: UICollectionViewCompositionalLayout.list(using: layout)
        )
        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        collectionView.delegate = self
        collectionView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(collectionView)
        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func configureDataSource() {
        let cell = UICollectionView.CellRegistration<UICollectionViewListCell, String> {
            [weak self] cell, _, id in
            guard let item = self?.itemsByID[id] else { return }
            cell.contentConfiguration = UIHostingConfiguration {
                MessageBubbleView(item: item) { [weak self] in
                    self?.onRetry?(item.message)
                }
                .contextMenu {
                    Button {
                        self?.onReply?(item.message)
                    } label: {
                        Label(
                            String(localized: "chats.reply", defaultValue: "Ответить"),
                            systemImage: "arrowshape.turn.up.left"
                        )
                    }
                }
            }
            .margins(.vertical, item.isLastInGroup ? 6 : 1)
            cell.backgroundConfiguration = .clear()
        }

        let header = UICollectionView.SupplementaryRegistration<UICollectionViewListCell>(
            elementKind: UICollectionView.elementKindSectionHeader
        ) { [weak self] view, _, indexPath in
            guard let day = self?.dataSource.snapshot().sectionIdentifiers[indexPath.section] else { return }
            view.contentConfiguration = UIHostingConfiguration {
                DaySeparatorView(day: day)
            }
            view.backgroundConfiguration = .clear()
        }

        dataSource = UICollectionViewDiffableDataSource<Date, String>(collectionView: collectionView) {
            view, indexPath, id in
            view.dequeueConfiguredReusableCell(using: cell, for: indexPath, item: id)
        }
        dataSource.supplementaryViewProvider = { view, _, indexPath in
            view.dequeueConfiguredReusableSupplementary(using: header, for: indexPath)
        }
    }

    // MARK: - Прокрутка

    private var isNearBottom: Bool {
        let distance = collectionView.contentSize.height
            - collectionView.contentOffset.y
            - collectionView.bounds.height
        return distance < 80
    }

    private func scrollToBottom(animated: Bool) {
        let bottom = max(
            -collectionView.adjustedContentInset.top,
            collectionView.contentSize.height
                - collectionView.bounds.height
                + collectionView.adjustedContentInset.bottom
        )
        collectionView.setContentOffset(CGPoint(x: 0, y: bottom), animated: animated)
    }

    private func scroll(to id: String) {
        guard let indexPath = dataSource.indexPath(for: id) else {
            scrollToBottom(animated: false)
            return
        }
        collectionView.scrollToItem(at: indexPath, at: .top, animated: false)
    }
}

extension MessageListViewController: UICollectionViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Подгружаем заранее: к моменту, когда человек долистает, страница уже тут.
        guard hasContent, scrollView.contentOffset.y < scrollView.bounds.height else { return }
        onReachTop?()
    }
}

/// Разделитель дня — та самая «пилюля» по центру.
private struct DaySeparatorView: View {
    let day: Date

    var body: some View {
        Text(title)
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs)
            .background(Palette.muted, in: Capsule())
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.md)
    }

    private var title: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) {
            return String(localized: "chats.today", defaultValue: "Сегодня")
        }
        if calendar.isDateInYesterday(day) {
            return String(localized: "chats.yesterday", defaultValue: "Вчера")
        }
        return day.formatted(.dateTime.day().month(.wide))
    }
}
