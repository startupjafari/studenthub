package kz.studenthub.app.features.chats

import android.content.Context
import android.content.Intent
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.provider.Settings
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.shell.LocalServices

/**
 * GIF, который сервер хранит беззвучным MP4 (`animation`), — как в Telegram: играет в
 * пузыре сам, по кругу и без звука, без кнопки и длительности, с подписью «GIF» в углу.
 *
 * Плеер — системный `MediaPlayer` на `TextureView`: Media3 в зависимостях нет. Он живёт,
 * пока пузырь на экране: ушёл из ленты — поверхность уничтожена и плеер отпущен, так что
 * десятки GIF в истории не держат десятки декодеров. Анимации выключены в системе —
 * показываем первый кадр и стоим.
 */
@Composable
internal fun AnimationAttachment(attachment: AttachmentEntity, converted: ChatsApi.AttachmentLink? = null) {
    val context = LocalContext.current
    val services = LocalServices.current
    val scope = rememberCoroutineScope()
    // Переведённый после отправки GIF: на диске у отправителя лежит ещё `image/gif`,
    // а играть нужно MP4 по ссылке.
    val source = converted?.url ?: rememberAttachmentSource(attachment)
    val mime = converted?.mime ?: attachment.mime
    val autoplay = remember { animationsEnabled(context) }
    val label = stringResource(R.string.chats_preview_gif)
    val ratio = aspectRatio(attachment.width, attachment.height)

    Box(
        Modifier
            .width(MAX_WIDTH)
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(Radius.lg))
            .background(AppTheme.colors.muted)
            .semantics { contentDescription = label }
            .clickable {
                // Просмотрщика в приложении нет — как и видео, GIF открывает система.
                // Внешний плеер играет его один раз: по кругу умеет только пузырь.
                scope.launch {
                    val url = services.attachmentUrls.url(attachment.id) ?: return@launch
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(url.toUri(), mime))
                    }
                }
            },
    ) {
        if (source != null) {
            key(source) {
                val loop = remember { LoopingVideo(source, autoplay) }
                DisposableEffect(loop) { onDispose { loop.release() } }
                AndroidView(
                    factory = { TextureView(it).apply { surfaceTextureListener = loop.attach(this) } },
                    // Пока нет первого кадра, `TextureView` прозрачен — виден фон-заглушка.
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        Text(
            label,
            style = AppType.meta,
            color = Color.White,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(Spacing.sm)
                .background(AppTheme.colors.overlay.copy(alpha = 0.45f), RoundedCornerShape(Radius.sm))
                .padding(horizontal = Spacing.sm, vertical = 1.dp),
        )
    }
}

private val MAX_WIDTH = 240.dp

/**
 * Вложение `image/gif`. Сервер переводит GIF в MP4 через секунды после сообщения, и
 * сообщение успевает прийти со старым mime. Ссылка знает, каким файл стал: если уже
 * анимацией — играем MP4, иначе остаётся картинка.
 */
@Composable
internal fun LegacyGifAttachment(attachment: AttachmentEntity) {
    val services = LocalServices.current
    val link by produceState<ChatsApi.AttachmentLink?>(null, attachment.id) { value = services.attachmentUrls.link(attachment.id) }
    val converted = link?.takeIf { it.animation && it.mime?.startsWith("video/") != false }
    if (converted != null) AnimationAttachment(attachment, converted) else ImageAttachment(attachment)
}

/** Пропорции из размеров сервера; крайности обрезаем, чтобы пузырь не стал полосой. */
private fun aspectRatio(width: Int?, height: Int?): Float {
    if (width == null || height == null || width <= 0 || height <= 0) return 1f
    return (width.toFloat() / height).coerceIn(0.6f, 2f)
}

/** Системный переключатель «Масштаб анимации — выкл.»: тогда GIF не крутим. */
private fun animationsEnabled(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }
        .getOrDefault(1f) != 0f

/**
 * Беззвучный ролик по кругу на поверхности `TextureView`. Плеер создаётся, когда
 * поверхность готова, и отпускается вместе с ней — или раньше, из `onDispose`.
 */
private class LoopingVideo(
    private val source: String,
    private val autoplay: Boolean,
) : TextureView.SurfaceTextureListener {
    private var view: TextureView? = null
    private var player: MediaPlayer? = null
    private var surface: Surface? = null
    private var released = false

    fun attach(target: TextureView): TextureView.SurfaceTextureListener {
        view = target
        return this
    }

    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        if (released || player != null) return
        val output = Surface(texture)
        val created = MediaPlayer()
        runCatching {
            created.setSurface(output)
            created.setDataSource(source)
            created.isLooping = true
            created.setVolume(0f, 0f)
            created.setOnPreparedListener { it.start() }
            created.setOnVideoSizeChangedListener { _, w, h -> crop(w, h) }
            created.setOnInfoListener { mp, what, _ ->
                // Анимации выключены: первый кадр показан — дальше стоим.
                if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START && !autoplay) runCatching { mp.pause() }
                false
            }
            // Ссылка протухла или файл не прочитан — плеер в ошибке бесполезен; останется
            // заглушка, а нажатие всё равно откроет файл.
            created.setOnErrorListener { _, _, _ ->
                stop()
                true
            }
            created.prepareAsync()
            player = created
            surface = output
        }.onFailure {
            created.release()
            output.release()
        }
    }

    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        // До подготовки размеры кадра — 0, `crop` их пропустит; в ошибке плеер бросает.
        player?.let { runCatching { crop(it.videoWidth, it.videoHeight) } }
    }

    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        stop()
        return true
    }

    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit

    fun release() {
        released = true
        stop()
        view = null
    }

    private fun stop() {
        player?.release()
        player = null
        surface?.release()
        surface = null
    }

    /** Заполнить рамку без искажений: `TextureView` растягивает кадр, матрица возвращает пропорции. */
    private fun crop(videoWidth: Int, videoHeight: Int) {
        val target = view ?: return
        if (videoWidth <= 0 || videoHeight <= 0 || target.width == 0 || target.height == 0) return
        val w = target.width.toFloat()
        val h = target.height.toFloat()
        val scale = maxOf(w / videoWidth, h / videoHeight)
        target.setTransform(Matrix().apply { setScale(videoWidth * scale / w, videoHeight * scale / h, w / 2, h / 2) })
    }
}
