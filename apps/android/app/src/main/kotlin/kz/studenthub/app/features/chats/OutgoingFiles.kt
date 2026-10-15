package kz.studenthub.app.features.chats

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.graphics.scale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kz.studenthub.app.core.chats.OutgoingAttachment
import java.io.File
import java.util.UUID

/**
 * Файл из системного выбора — в кэш приложения. Копия нужна: доступ к чужому `content://`
 * живёт, пока жива активность, а отправка может пережить и её, и перезапуск процесса.
 */
object OutgoingFiles {
    /** Длинная сторона фото. Больше — лишние мегабайты мобильного трафика без разницы на экране. */
    private const val MAX_IMAGE_SIDE = 2560

    suspend fun copy(context: Context, uri: Uri): OutgoingAttachment? = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "file"
        val folder = File(outgoingDir(context), UUID.randomUUID().toString()).apply { mkdirs() }
        val target = File(folder, name.replace('/', '_'))
        runCatching {
            resolver.openInputStream(uri)?.use { input -> target.outputStream().use { input.copyTo(it) } } ?: return@withContext null
        }.onFailure { return@withContext null }

        if (mime.startsWith("image/") && mime != "image/gif") downscale(target)?.let { return@withContext it }
        val bounds = if (mime.startsWith("image/")) imageSize(target) else null
        OutgoingAttachment(target, mime, target.name, bounds?.first, bounds?.second)
    }

    /** Ужать крупное фото до JPEG; маленькие уходят как есть. */
    private fun downscale(file: File): OutgoingAttachment? {
        val (width, height) = imageSize(file) ?: return null
        val longest = maxOf(width, height)
        if (longest <= MAX_IMAGE_SIDE) return null
        var sample = 1
        while (longest / (sample * 2) >= MAX_IMAGE_SIDE) sample *= 2
        val decoded = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val scale = MAX_IMAGE_SIDE.toFloat() / maxOf(decoded.width, decoded.height)
        val scaled = if (scale < 1f) {
            decoded.scale((decoded.width * scale).toInt(), (decoded.height * scale).toInt())
        } else {
            decoded
        }
        val target = File(file.parentFile, file.nameWithoutExtension + ".jpg")
        target.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        if (target != file) file.delete()
        return OutgoingAttachment(target, "image/jpeg", target.name, scaled.width, scaled.height)
    }

    private fun imageSize(file: File): Pair<Int, Int>? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, options)
        return if (options.outWidth > 0 && options.outHeight > 0) options.outWidth to options.outHeight else null
    }
}
