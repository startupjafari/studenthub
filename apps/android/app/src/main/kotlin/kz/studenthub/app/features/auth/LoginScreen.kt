package kz.studenthub.app.features.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.FieldError
import kz.studenthub.app.designsystem.FieldLabel
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.FormField
import kz.studenthub.app.designsystem.Motion
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.TokenGalleryScreen
import kz.studenthub.app.designsystem.rememberReduceMotion
import kz.studenthub.app.shell.LocalServices

/**
 * Экран входа. Тексты повторяют веб слово в слово (`apps/web/messages/ru.json`,
 * раздел `Auth`): один продукт не должен здороваться по-разному.
 */
@Composable
fun LoginScreen() {
    val services = LocalServices.current
    val model = viewModel { LoginModel(services.auth, services.sessionModel::adopt) }
    val reduceMotion = rememberReduceMotion()
    var showsGallery by rememberSaveable { mutableStateOf(false) }

    if (BuildConfig.DEBUG && showsGallery) {
        TokenGalleryScreen(onClose = { showsGallery = false })
        return
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xxl),
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background)
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.xl),
    ) {
        Header()
        AnimatedContent(
            targetState = model.step,
            transitionSpec = { Motion.crossfade(reduceMotion) },
            label = "login-step",
            modifier = Modifier.widthIn(max = 480.dp),
        ) { step ->
            when (step) {
                LoginModel.Step.CREDENTIALS -> CredentialsStep(model)
                LoginModel.Step.TWO_FACTOR -> TwoFactorStep(model)
            }
        }
        // Витрина дизайн-ядра держится на экране входа: до сервера дотягивается не
        // всякая отладочная сборка, а токены смотреть надо.
        if (BuildConfig.DEBUG) {
            QuietButton(text = "Дизайн-ядро", onClick = { showsGallery = true }, modifier = Modifier.widthIn(max = 480.dp))
        }
    }
}

@Composable
private fun Header() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
        modifier = Modifier
            .padding(top = Spacing.xxl)
            .semantics(mergeDescendants = true) { heading() },
    ) {
        Text(stringResource(R.string.auth_loginTitle), style = AppType.pageTitle, color = AppTheme.colors.foreground)
        Text(stringResource(R.string.auth_welcomeSubtitle), style = AppType.meta, color = AppTheme.colors.mutedForeground)
    }
}

/** Первый шаг: идентификатор и пароль. */
@Composable
private fun CredentialsStep(model: LoginModel) {
    val focus = LocalFocusManager.current
    val passwordFocus = remember { FocusRequester() }
    var showsPassword by rememberSaveable { mutableStateOf(false) }
    val submit = {
        focus.clearFocus()
        model.submitCredentials()
    }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl), modifier = Modifier.fillMaxWidth()) {
        FormAlert(model.formError?.resolve())

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val label = stringResource(R.string.auth_identifier)
            FieldLabel(label)
            FormField(
                value = model.identifier,
                onValueChange = { model.identifier = it },
                label = label,
                placeholder = stringResource(R.string.auth_identifierPlaceholder),
                isInvalid = model.identifierError != null,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
                modifier = Modifier.semantics { contentType = ContentType.Username },
            )
            FieldError(model.identifierError?.resolve())
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val label = stringResource(R.string.auth_password)
            FieldLabel(label)
            FormField(
                value = model.password,
                onValueChange = { model.password = it },
                label = label,
                isInvalid = model.passwordError != null,
                visualTransformation = if (showsPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                modifier = Modifier
                    .focusRequester(passwordFocus)
                    .semantics { contentType = ContentType.Password },
                trailing = {
                    IconButton(onClick = { showsPassword = !showsPassword }) {
                        Icon(
                            if (showsPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = stringResource(
                                if (showsPassword) R.string.auth_hidePassword else R.string.auth_showPassword,
                            ),
                            tint = AppTheme.colors.mutedForeground,
                        )
                    }
                },
            )
            FieldError(model.passwordError?.resolve())
        }

        PrimaryButton(
            text = stringResource(if (model.isBusy) R.string.auth_signingIn else R.string.auth_signIn),
            onClick = submit,
            isLoading = model.isBusy,
        )
    }
}

/**
 * Второй шаг: код из приложения-аутентификатора или резервный код. Отдельный шаг, а
 * не диалог поверх формы: пароль здесь уже не нужен.
 */
@Composable
private fun TwoFactorStep(model: LoginModel) {
    val focus = LocalFocusManager.current
    val codeFocus = remember { FocusRequester() }
    val submit = {
        focus.clearFocus()
        model.submitCode()
    }
    LaunchedEffect(Unit) { codeFocus.requestFocus() }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl), modifier = Modifier.fillMaxWidth()) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
            modifier = Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { heading() },
        ) {
            Text(stringResource(R.string.auth_twoFactorTitle), style = AppType.sectionTitle, color = AppTheme.colors.foreground)
            Text(
                stringResource(R.string.auth_twoFactorPrompt),
                style = AppType.meta,
                color = AppTheme.colors.mutedForeground,
                textAlign = TextAlign.Center,
            )
        }

        FormAlert(model.formError?.resolve())

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val label = stringResource(R.string.auth_twoFactorCodeLabel)
            FieldLabel(label)
            FormField(
                value = model.code,
                onValueChange = { model.code = it },
                label = label,
                isInvalid = model.codeError != null,
                textStyle = AppType.tabular(AppType.body),
                // Не цифровая клавиатура: резервный код не из одних цифр.
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                modifier = Modifier
                    .focusRequester(codeFocus)
                    .semantics { contentType = ContentType.SmsOtpCode },
            )
            FieldError(model.codeError?.resolve())
            Text(stringResource(R.string.auth_twoFactorBackupHint), style = AppType.meta, color = AppTheme.colors.mutedForeground)
        }

        PrimaryButton(text = stringResource(R.string.auth_twoFactorVerify), onClick = submit, isLoading = model.isBusy)
        QuietButton(text = stringResource(R.string.auth_twoFactorBack), onClick = model::startOver)
    }
}
