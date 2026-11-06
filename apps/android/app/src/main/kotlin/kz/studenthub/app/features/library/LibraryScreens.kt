package kz.studenthub.app.features.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.PowerOff
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import kz.studenthub.app.R
import kz.studenthub.app.core.library.BookCardDto
import kz.studenthub.app.core.library.LoanDto
import kz.studenthub.app.core.library.ReservationDto
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.core.ui.UiText
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.FormField
import kz.studenthub.app.designsystem.ListDivider
import kz.studenthub.app.designsystem.ListGroup
import kz.studenthub.app.designsystem.ListRow
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.features.study.EmptyRow
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/*
 * Библиотека вуза у студента и старосты (Фаза 20.10) — повторяет веб
 * (`views/library-reader`, каталог в режиме `reader`): каталог с поиском, книга с бронью,
 * «Мои книги» и справка «задолженностей нет». Выдаёт и принимает книги библиотекарь — в вебе, не здесь.
 */

/** Каталог: поиск, раздел, «есть на полке»; страницы догружаются по прокрутке. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen() {
    val services = LocalServices.current
    val model = viewModel { CatalogModel(services.libraryApi) }
    LaunchedEffect(model) { if (!model.loaded) model.start() }
    val keyboard = LocalSoftwareKeyboardController.current

    ScreenScaffold(title = stringResource(R.string.books_title)) {
        if (model.isDisabled) {
            LibraryDisabled()
            return@ScreenScaffold
        }
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::reloadNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "mine") {
                    ListGroup {
                        ListRow(stringResource(R.string.books_myBooks), Icons.Outlined.Bookmarks) {
                            services.router.push(AppRoute.Section(MoreSection.MY_BOOKS))
                        }
                    }
                }
                item(key = "search") {
                    val label = stringResource(R.string.books_searchPlaceholder)
                    FormField(
                        value = model.query,
                        onValueChange = model::type,
                        label = label,
                        placeholder = label,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                        trailing = { Icon(Icons.Outlined.Search, contentDescription = null, tint = AppTheme.colors.mutedForeground) },
                    )
                }
                item(key = "filters") { CatalogFilters(model) }
                model.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                items(model.books, key = { it.id }) { book ->
                    BookRow(book) { services.router.push(AppRoute.Book(book.id)) }
                }
                if (model.loaded && model.books.isEmpty() && model.failure == null) {
                    item(key = "empty") {
                        if (model.isFiltered) {
                            EmptyRow(stringResource(R.string.books_nothingFound))
                        } else {
                            EmptyRow(stringResource(R.string.books_emptyTitle) + "\n" + stringResource(R.string.books_emptyHint))
                        }
                    }
                }
                if (model.hasMore) {
                    item(key = "more") {
                        // Хвост показался — просим следующую страницу.
                        LaunchedEffect(model.books.size) { model.loadMore() }
                        Box(Modifier.fillMaxWidth().padding(vertical = Spacing.lg), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = AppTheme.colors.primary, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                        }
                    }
                }
            }
        }
    }
}

/** Раздел — выпадающим списком, «есть на полке» — флажком: как фильтры над каталогом в вебе. */
@Composable
private fun CatalogFilters(model: CatalogModel) {
    val colors = AppTheme.colors
    var menu by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(Modifier.weight(1f)) {
            if (model.sections.isNotEmpty() || model.section != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { menu = true }.padding(vertical = Spacing.sm),
                ) {
                    Text(
                        model.section ?: stringResource(R.string.books_allSections),
                        style = AppType.meta,
                        color = colors.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Icon(Icons.Outlined.ArrowDropDown, contentDescription = stringResource(R.string.books_section), tint = colors.primary)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.books_allSections)) }, onClick = {
                        menu = false
                        model.pickSection(null)
                    })
                    model.sections.forEach { section ->
                        DropdownMenuItem(text = { Text(section) }, onClick = {
                            menu = false
                            model.pickSection(section)
                        })
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { model.toggleAvailable() }) {
            Checkbox(checked = model.onlyAvailable, onCheckedChange = { model.toggleAvailable() })
            Text(stringResource(R.string.books_onlyAvailable), style = AppType.meta, color = colors.foreground)
        }
    }
}

@Composable
private fun BookRow(book: BookCardDto, onClick: () -> Unit) {
    val colors = AppTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card, RoundedCornerShape(Radius.xl))
            .clickable(onClick = onClick)
            .padding(Spacing.lg),
    ) {
        BookCover(book.coverUrl, width = 48.dp)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.weight(1f)) {
            Text(book.title, style = AppType.cardTitle, color = colors.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            book.byline.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = AppType.meta, color = colors.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            book.section?.let { Text(it, style = AppType.meta, color = colors.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            LibraryBadgeView(LibraryBadge.availability(book.availability))
        }
    }
}

/**
 * Книга: обложка, наличие, своя бронь или срок выдачи, кнопка брони и описание. Тот же
 * экран открывает и QR-наклейка экземпляра — по коду (`BookRef.CopyCode`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookScreen(ref: BookRef) {
    val services = LocalServices.current
    val context = LocalContext.current
    val model = viewModel { BookModel(ref, services.libraryApi) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model) { if (model.book == null) model.load() }
    LaunchedEffect(model.notice) {
        val notice = model.notice ?: return@LaunchedEffect
        model.noticeShown()
        snackbar.showSnackbar(notice.resolve(context))
    }
    var confirmCancel by remember { mutableStateOf<String?>(null) }
    val formatDay = rememberDayFormat()
    val colors = AppTheme.colors
    val book = model.book

    ScreenScaffold(title = book?.title ?: stringResource(R.string.books_book), snackbar = snackbar) {
        if (model.isDisabled) {
            LibraryDisabled()
            return@ScreenScaffold
        }
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.xl),
            ) {
                model.failure?.let { FormAlert(it.resolve()) }
                if (book == null) return@Column

                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    BookCover(book.coverUrl, width = 96.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.weight(1f)) {
                        Text(book.title, style = AppType.sectionTitle, color = colors.foreground)
                        if (book.authors.isNotBlank()) Text(book.authors, style = AppType.meta, color = colors.mutedForeground)
                        LibraryBadgeView(LibraryBadge.availability(book.availability, detailed = true))
                        model.onHands?.let { LibraryBadgeView(LibraryBadge.loan(it, formatDay)) }
                        model.mine?.let { LibraryBadgeView(LibraryBadge.reservation(it, formatDay)) }
                    }
                }

                when (val action = model.action) {
                    is BookAction.Reserve -> PrimaryButton(
                        text = stringResource(if (action.queue) R.string.books_joinQueue else R.string.books_reserve),
                        onClick = model::reserveNow,
                        enabled = action.enabled,
                        isLoading = model.isWorking,
                    )
                    is BookAction.Cancel -> QuietButton(
                        text = stringResource(R.string.books_cancelReservation),
                        color = colors.destructive,
                        onClick = { if (!model.isWorking) confirmCancel = action.reservationId },
                    )
                    BookAction.None -> Unit
                }
                model.hint?.let { Text(stringResource(it), style = AppType.meta, color = colors.mutedForeground) }

                val facts = listOfNotNull(
                    book.isbn?.let { stringResource(R.string.books_isbn) to it },
                    book.publisher?.let { stringResource(R.string.books_publisher) to it },
                    book.year?.let { stringResource(R.string.books_year) to it.toString() },
                    book.section?.let { stringResource(R.string.books_section) to it },
                )
                if (facts.isNotEmpty()) {
                    ListGroup {
                        facts.forEachIndexed { index, (label, value) ->
                            if (index > 0) ListDivider(inset = false)
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md),
                            ) {
                                Text(label, style = AppType.meta, color = colors.mutedForeground, modifier = Modifier.weight(1f))
                                Text(value, style = AppType.meta, color = colors.foreground, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }

                book.description?.takeIf { it.isNotBlank() }?.let {
                    Text(stringResource(R.string.books_description), style = AppType.sectionTitle, color = colors.foreground)
                    Text(it, style = AppType.body, color = colors.foreground)
                }
            }
        }
    }

    confirmCancel?.let { id ->
        ConfirmDialog(
            title = stringResource(R.string.books_cancelTitle),
            text = stringResource(R.string.books_cancelDesc, book?.title.orEmpty()),
            confirm = stringResource(R.string.books_cancelReservation),
            destructive = true,
            onConfirm = {
                confirmCancel = null
                model.cancelNow(id)
            },
            onDismiss = { confirmCancel = null },
        )
    }
}

/**
 * «Мои книги»: на руках (срок, просрочка, «Это не я»), брони и история. Перечитывается
 * при каждом возврате на экран: бронь, сделанная на карточке книги, должна быть видна сразу.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyBooksScreen() {
    val services = LocalServices.current
    val context = LocalContext.current
    val model = viewModel { MyBooksModel(services.libraryApi) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model) { model.refresh() }
    LaunchedEffect(model.notice) {
        val notice = model.notice ?: return@LaunchedEffect
        model.noticeShown()
        snackbar.showSnackbar(notice.resolve(context))
    }
    var confirmDispute by remember { mutableStateOf<LoanDto?>(null) }
    var confirmCancel by remember { mutableStateOf<ReservationDto?>(null) }
    val formatDay = rememberDayFormat()
    val open = { id: String -> services.router.push(AppRoute.Book(id)) }

    ScreenScaffold(title = stringResource(R.string.books_myBooks), snackbar = snackbar) {
        if (model.isDisabled) {
            LibraryDisabled()
            return@ScreenScaffold
        }
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                model.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                if (model.overdueCount > 0) {
                    item(key = "overdue") { FormAlert(stringResource(R.string.books_overdueBanner, model.overdueCount)) }
                }
                if (!model.loaded) return@LazyColumn

                // Справка для обходного листа — там же, где в вебе: в «Моих книгах».
                item(key = "clearance") {
                    ListGroup {
                        ListRow(
                            title = stringResource(R.string.books_clearanceTitle),
                            icon = Icons.Outlined.Verified,
                            subtitle = stringResource(R.string.books_clearanceSubtitle),
                        ) { services.router.push(AppRoute.Section(MoreSection.LIBRARY_CLEARANCE)) }
                    }
                }

                item(key = "onHands") { SectionHeader(R.string.books_onHands, R.string.books_onHandsSubtitle) }
                if (model.onHands.isEmpty()) {
                    item(key = "noLoans") {
                        Column {
                            EmptyRow(stringResource(R.string.books_noLoans))
                            // Под «Моими книгами» в стеке всегда каталог: и из списка «Ещё», и из уведомления.
                            QuietButton(stringResource(R.string.books_toCatalog), color = AppTheme.colors.primary, onClick = { services.router.pop() })
                        }
                    }
                }
                items(model.onHands, key = { "loan-${it.id}" }) { loan ->
                    LoanCard(
                        loan = loan,
                        formatDay = formatDay,
                        isBusy = model.busyId == loan.id,
                        onOpen = { open(loan.book.id) },
                        onDispute = { confirmDispute = loan },
                    )
                }

                item(key = "reservations") { SectionHeader(R.string.books_reservations, R.string.books_reservationsSubtitle) }
                if (model.activeReservations.isEmpty()) {
                    item(key = "noReservations") {
                        Text(stringResource(R.string.books_noReservations), style = AppType.meta, color = AppTheme.colors.mutedForeground)
                    }
                }
                items(model.activeReservations, key = { "reservation-${it.id}" }) { reservation ->
                    ReservationCard(
                        reservation = reservation,
                        formatDay = formatDay,
                        isBusy = model.busyId == reservation.id,
                        onOpen = { open(reservation.book.id) },
                        onCancel = { confirmCancel = reservation },
                    )
                }

                if (model.history.isNotEmpty()) {
                    item(key = "history") { SectionHeader(R.string.books_history, R.string.books_historySubtitle) }
                    items(model.history, key = { "history-${it.id}" }) { loan ->
                        LoanCard(loan = loan, formatDay = formatDay, isBusy = false, onOpen = { open(loan.book.id) }, onDispute = {})
                    }
                }
            }
        }
    }

    confirmDispute?.let { loan ->
        ConfirmDialog(
            title = stringResource(R.string.books_disputeTitle),
            text = stringResource(R.string.books_disputeDesc, loan.book.title),
            confirm = stringResource(R.string.books_dispute),
            destructive = false,
            onConfirm = {
                confirmDispute = null
                model.disputeNow(loan.id)
            },
            onDismiss = { confirmDispute = null },
        )
    }
    confirmCancel?.let { reservation ->
        ConfirmDialog(
            title = stringResource(R.string.books_cancelTitle),
            text = stringResource(R.string.books_cancelDesc, reservation.book.title),
            confirm = stringResource(R.string.books_cancelReservation),
            destructive = true,
            onConfirm = {
                confirmCancel = null
                model.cancelNow(reservation.id)
            },
            onDismiss = { confirmCancel = null },
        )
    }
}

/**
 * Справка «задолженностей в библиотеке нет» (`/my-books/clearance` в вебе): статус на
 * момент запроса, при долгах — что вернуть, и сведения для обходного листа. Печать — в вебе;
 * здесь справку показывают с экрана.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClearanceScreen() {
    val services = LocalServices.current
    val model = viewModel { ClearanceModel(services.libraryApi) }
    // Справка — на момент запроса: перечитываем при каждом открытии.
    LaunchedEffect(model) { model.refresh() }
    val formatDay = rememberDayFormat()
    val formatMoment = rememberMomentFormat()
    val colors = AppTheme.colors

    ScreenScaffold(title = stringResource(R.string.books_clearanceTitle)) {
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                model.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                val summary = model.summary ?: return@LazyColumn
                val checkedAt = formatMoment(summary.checkedAt)

                item(key = "status") {
                    if (summary.isClear) {
                        ClearanceStatus(
                            icon = Icons.Filled.Verified,
                            tint = colors.success,
                            title = stringResource(R.string.books_clearTitle),
                            body = stringResource(R.string.books_clearBody, summary.reader.name, checkedAt),
                        )
                    } else {
                        ClearanceStatus(
                            icon = Icons.Filled.Warning,
                            tint = colors.destructive,
                            title = stringResource(R.string.books_notClearTitle, summary.debts.size),
                            body = null,
                        )
                    }
                }
                item(key = "hint") {
                    Text(
                        stringResource(if (summary.isClear) R.string.books_clearanceShowHint else R.string.books_clearanceSubtitle),
                        style = AppType.meta,
                        color = colors.mutedForeground,
                    )
                }

                if (!summary.isClear) {
                    item(key = "debtsTitle") {
                        Text(
                            stringResource(R.string.books_debtsTitle),
                            style = AppType.sectionTitle,
                            color = colors.foreground,
                            modifier = Modifier.padding(top = Spacing.sm),
                        )
                    }
                    items(summary.debts, key = { "debt-${it.id}" }) { loan ->
                        LibraryCard(coverUrl = loan.book.coverUrl, onOpen = { services.router.push(AppRoute.Book(loan.book.id)) }) {
                            Text(loan.book.title, style = AppType.cardTitle, color = colors.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                stringResource(R.string.books_inventoryNumber, loan.copy.inventoryNumber),
                                style = AppType.meta,
                                color = colors.mutedForeground,
                            )
                            LibraryBadgeView(LibraryBadge.debt(loan, formatDay))
                        }
                    }
                    if (summary.lostDebts > 0) {
                        item(key = "lostHint") {
                            Text(stringResource(R.string.books_lostHint), style = AppType.meta, color = colors.mutedForeground)
                        }
                    }
                }

                item(key = "details") {
                    // Пустое поле (нет группы, не указан билет) не рисуется вовсе.
                    val rows = listOf(
                        stringResource(R.string.books_clearanceName) to summary.reader.name,
                        stringResource(R.string.books_clearanceGroup) to summary.reader.group,
                        stringResource(R.string.books_clearanceFaculty) to summary.reader.faculty,
                        stringResource(R.string.books_clearanceCard) to summary.reader.studentCardNumber,
                        stringResource(R.string.books_clearanceUniversity) to summary.university,
                        stringResource(R.string.books_clearanceChecked) to checkedAt,
                    ).mapNotNull { (label, value) -> value?.takeIf { it.isNotBlank() }?.let { label to it } }
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.padding(top = Spacing.sm)) {
                        Text(stringResource(R.string.books_clearanceDetails), style = AppType.sectionTitle, color = colors.foreground)
                        ListGroup {
                            rows.forEachIndexed { index, (label, value) ->
                                if (index > 0) ListDivider(inset = false)
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md),
                                ) {
                                    Text(label, style = AppType.meta, color = colors.mutedForeground, modifier = Modifier.weight(1f))
                                    Text(value, style = AppType.meta, color = colors.foreground, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Итог справки: иконка тона, заголовок и пояснение на бледной подложке того же тона. */
@Composable
private fun ClearanceStatus(icon: ImageVector, tint: Color, title: String, body: String?) {
    val colors = AppTheme.colors
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .background(tint.copy(alpha = 0.1f), RoundedCornerShape(Radius.xl))
            .semantics(mergeDescendants = true) {}
            .padding(Spacing.lg),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(28.dp))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.weight(1f)) {
            Text(title, style = AppType.cardTitle, color = colors.foreground)
            body?.let { Text(it, style = AppType.body, color = colors.foreground) }
        }
    }
}

@Composable
private fun LoanCard(loan: LoanDto, formatDay: (LocalDate) -> String, isBusy: Boolean, onOpen: () -> Unit, onDispute: () -> Unit) {
    val colors = AppTheme.colors
    val issued = formatDay(loan.issuedAt.atZone(ZoneId.systemDefault()).toLocalDate())
    LibraryCard(coverUrl = loan.book.coverUrl, onOpen = onOpen) {
        Text(loan.book.title, style = AppType.cardTitle, color = colors.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            stringResource(R.string.books_issuedOn, issued, loan.copy.inventoryNumber),
            style = AppType.meta,
            color = colors.mutedForeground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        LibraryBadgeView(LibraryBadge.loan(loan, formatDay))
        if (loan.isOpen) {
            if (loan.disputedAt != null) {
                LibraryBadgeView(LibraryBadge(UiText.Res(R.string.books_disputed), LibraryBadge.Tone.WARNING))
            } else {
                CardAction(stringResource(R.string.books_dispute), color = colors.primary, isBusy = isBusy, onClick = onDispute)
            }
        }
    }
}

@Composable
private fun ReservationCard(reservation: ReservationDto, formatDay: (LocalDate) -> String, isBusy: Boolean, onOpen: () -> Unit, onCancel: () -> Unit) {
    val colors = AppTheme.colors
    val copy = reservation.copy
    LibraryCard(coverUrl = reservation.book.coverUrl, onOpen = onOpen) {
        Text(reservation.book.title, style = AppType.cardTitle, color = colors.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            if (reservation.status == "READY" && copy != null) {
                stringResource(R.string.books_readyAt, copy.inventoryNumber)
            } else {
                stringResource(R.string.books_queuedNote)
            },
            style = AppType.meta,
            color = colors.mutedForeground,
        )
        LibraryBadgeView(LibraryBadge.reservation(reservation, formatDay))
        CardAction(stringResource(R.string.books_cancelReservation), color = colors.destructive, isBusy = isBusy, onClick = onCancel)
    }
}

/** Строка «Моих книг»: обложка слева, текст и действия справа; нажатие ведёт к книге. */
@Composable
private fun LibraryCard(coverUrl: String?, onOpen: () -> Unit, content: @Composable () -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .background(AppTheme.colors.card, RoundedCornerShape(Radius.xl))
            .clickable(onClick = onOpen)
            .padding(Spacing.lg),
    ) {
        BookCover(coverUrl, width = 40.dp)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.weight(1f)) { content() }
    }
}

/** Тихое действие в карточке; пока идёт запрос — индикатор вместо подписи. */
@Composable
private fun CardAction(text: String, color: Color, isBusy: Boolean, onClick: () -> Unit) {
    if (isBusy) {
        CircularProgressIndicator(color = color, strokeWidth = 2.dp, modifier = Modifier.padding(vertical = Spacing.sm).size(18.dp))
    } else {
        TextButton(onClick = onClick, contentPadding = PaddingValues(0.dp)) {
            Text(text, style = AppType.meta, color = color)
        }
    }
}

@Composable
private fun SectionHeader(title: Int, subtitle: Int) {
    Column(modifier = Modifier.padding(top = Spacing.sm)) {
        Text(stringResource(title), style = AppType.sectionTitle, color = AppTheme.colors.foreground)
        Text(stringResource(subtitle), style = AppType.meta, color = AppTheme.colors.mutedForeground)
    }
}

/** Ярлык — текст цвета тона на его же бледной подложке. */
@Composable
private fun LibraryBadgeView(badge: LibraryBadge) {
    val colors = AppTheme.colors
    val tint = when (badge.tone) {
        LibraryBadge.Tone.SUCCESS -> colors.success
        LibraryBadge.Tone.INFO -> colors.info
        LibraryBadge.Tone.WARNING -> colors.warning
        LibraryBadge.Tone.DESTRUCTIVE -> colors.destructive
        LibraryBadge.Tone.NEUTRAL -> colors.mutedForeground
    }
    Text(
        badge.text.resolve(),
        style = AppType.meta,
        color = tint,
        modifier = Modifier
            .background(tint.copy(alpha = 0.12f), RoundedCornerShape(Radius.md))
            .padding(horizontal = Spacing.md, vertical = Spacing.xs),
    )
}

/** Обложка в пропорциях книги (2:3); нет картинки — иконка на приглушённом фоне. */
@Composable
private fun BookCover(url: String?, width: Dp) {
    val colors = AppTheme.colors
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(width = width, height = width * 1.5f)
            .clip(RoundedCornerShape(Radius.md))
            .background(colors.muted),
    ) {
        Icon(Icons.AutoMirrored.Outlined.MenuBook, contentDescription = null, tint = colors.mutedForeground, modifier = Modifier.size(width / 2))
        if (!url.isNullOrEmpty()) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Вуз выключил библиотеку (`409 module`): объяснение вместо пустого экрана. */
@Composable
private fun LibraryDisabled() {
    val colors = AppTheme.colors
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
        modifier = Modifier.fillMaxSize().padding(Spacing.xl),
    ) {
        Icon(Icons.Outlined.PowerOff, contentDescription = null, tint = colors.mutedForeground, modifier = Modifier.size(36.dp))
        Text(stringResource(R.string.books_disabledTitle), style = AppType.sectionTitle, color = colors.foreground, textAlign = TextAlign.Center)
        Text(stringResource(R.string.books_disabledDescription), style = AppType.meta, color = colors.mutedForeground, textAlign = TextAlign.Center)
    }
}

/** Подтверждение действия, которое не отменить одним нажатием: отмена брони, «Это не я». */
@Composable
private fun ConfirmDialog(
    title: String,
    text: String,
    confirm: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AppTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.card,
        title = { Text(title, style = AppType.sectionTitle, color = colors.foreground) },
        text = { Text(text, style = AppType.body, color = colors.mutedForeground) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirm, color = if (destructive) colors.destructive else colors.primary) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_close), color = colors.foreground) }
        },
    )
}

/** Момент проверки справки — «23 октября 2026, 14:05» в часовом поясе телефона, как в вебе. */
@Composable
private fun rememberMomentFormat(): (Instant) -> String {
    val locale = currentLocale()
    return remember(locale) {
        val formatter = DateTimeFormatter.ofPattern("d MMMM yyyy, HH:mm", locale)
        val format: (Instant) -> String = { moment -> moment.atZone(ZoneId.systemDefault()).format(formatter) }
        format
    }
}

/** Дата срока или брони — «5 нояб.»: день приходит строкой по часам вуза, показываем его как есть. */
@Composable
private fun rememberDayFormat(): (LocalDate) -> String {
    val locale = currentLocale()
    return remember(locale) {
        val formatter = DateTimeFormatter.ofPattern("d MMM", locale)
        val format: (LocalDate) -> String = { day -> day.format(formatter) }
        format
    }
}
