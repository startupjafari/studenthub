package kz.studenthub.app.features.chats

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kz.studenthub.app.core.chats.OutgoingAttachment
import java.io.File
import java.util.UUID
import kotlin.math.log10

/**
 * Запись голосового. Пишем сразу в файл, а не в память: минута речи — мегабайт. Имя
 * начинается с `voice-` — по нему сервер и веб узнают голосовое (PROJECT.md §9.1a).
 */
class VoiceRecorder(private val context: Context, private val scope: CoroutineScope) {
    var isRecording by mutableStateOf(false)
        private set

    /** Настоящие показания микрофона, а не узор: по ним видно, записался ли звук. */
    val levels = mutableStateListOf<Float>()
    var durationMillis by mutableLongStateOf(0L)
        private set

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var meter: Job? = null
    private var startedAt = 0L

    fun start(): Boolean {
        val target = File(outgoingDir(context), "voice-${UUID.randomUUID()}.m4a")
        val created = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return runCatching {
            created.setAudioSource(MediaRecorder.AudioSource.MIC)
            created.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            created.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            created.setAudioChannels(1)
            created.setAudioSamplingRate(44_100)
            created.setAudioEncodingBitRate(64_000)
            created.setOutputFile(target.absolutePath)
            created.prepare()
            created.start()
            recorder = created
            file = target
            startedAt = System.currentTimeMillis()
            levels.clear()
            durationMillis = 0
            isRecording = true
            meter = scope.launch { meter() }
        }.onFailure {
            created.release()
            target.delete()
        }.isSuccess
    }

    /** Остановить и отдать файл. `null` — записи не было или она слишком короткая. */
    fun stop(): OutgoingAttachment? {
        meter?.cancel()
        val recorded = file
        val ok = runCatching { recorder?.stop() }.isSuccess
        recorder?.release()
        recorder = null
        isRecording = false
        if (!ok || recorded == null || recorded.length() == 0L || durationMillis < 400) {
            recorded?.delete()
            file = null
            return null
        }
        file = null
        return OutgoingAttachment(recorded, "audio/m4a", recorded.name)
    }

    /** Отменить: недописанное голосовое не нужно никому — файл удаляем сразу. */
    fun cancel() {
        meter?.cancel()
        runCatching { recorder?.stop() }
        recorder?.release()
        recorder = null
        isRecording = false
        file?.delete()
        file = null
        levels.clear()
        durationMillis = 0
    }

    private suspend fun meter() {
        while (scope.isActive && isRecording) {
            val amplitude = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
            // Амплитуду в децибелы, затем в 0…1: иначе тихая речь — почти нулевой столбик.
            val db = if (amplitude > 0) 20 * log10(amplitude / 32767.0) else -160.0
            levels += ((db + 50) / 50).toFloat().coerceIn(0f, 1f)
            if (levels.size > VISIBLE_BARS) levels.removeRange(0, levels.size - VISIBLE_BARS)
            durationMillis = System.currentTimeMillis() - startedAt
            delay(50)
        }
    }

    private companion object {
        /** Сколько столбиков помещается в строку: старые уезжают, волна не сжимается в кашу. */
        const val VISIBLE_BARS = 48
    }
}

/**
 * Проигрыватель одного голосового. Сбой загрузки возвращает его в исходное состояние:
 * следующее нажатие создаёт плеер заново, а не упирается в сломанный.
 */
class VoicePlayer(private val scope: CoroutineScope) {
    var isPlaying by mutableStateOf(false)
        private set
    var progress by mutableFloatStateOf(0f)
        private set
    var positionMillis by mutableLongStateOf(0L)
        private set

    private var player: MediaPlayer? = null
    private var prepared = false
    private var ticker: Job? = null

    fun play(source: String) {
        val existing = player
        if (existing != null) {
            // Ещё готовится — стартует сам по готовности. `start()` у неподготовленного
            // плеера — ошибка состояния, после которой он не играет вовсе.
            if (!prepared) return
            if (runCatching { existing.start() }.isFailure) {
                reset()
                return
            }
            isPlaying = true
            tick()
            return
        }
        val created = MediaPlayer()
        runCatching {
            created.setDataSource(source)
            created.setOnPreparedListener {
                prepared = true
                it.start()
                isPlaying = true
                tick()
            }
            created.setOnCompletionListener {
                isPlaying = false
                progress = 0f
                positionMillis = 0
                it.seekTo(0)
            }
            // Ссылка протухла, файл не скачался, формат не прочитан — плеер в состоянии
            // ошибки бесполезен: отпускаем его, следующее нажатие попробует заново.
            created.setOnErrorListener { _, _, _ ->
                reset()
                true
            }
            created.prepareAsync()
            player = created
        }.onFailure { created.release() }
    }

    fun pause() {
        runCatching { player?.pause() }
        isPlaying = false
        ticker?.cancel()
    }

    fun release() = reset()

    private fun reset() {
        ticker?.cancel()
        player?.release()
        player = null
        prepared = false
        isPlaying = false
        progress = 0f
        positionMillis = 0
    }

    private fun tick() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive && isPlaying) {
                val current = player ?: break
                val total = runCatching { current.duration }.getOrDefault(0)
                positionMillis = runCatching { current.currentPosition.toLong() }.getOrDefault(0)
                if (total > 0) progress = (positionMillis.toFloat() / total).coerceIn(0f, 1f)
                delay(200)
            }
        }
    }
}

/** «1:05» — длительность и позиция голосового. */
fun voiceTime(millis: Long): String {
    val seconds = (millis / 1000).coerceAtLeast(0)
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

/** Каталог исходящих файлов в кэше: оттуда же они и показываются до отправки. */
fun outgoingDir(context: Context): File = File(context.cacheDir, "outgoing").apply { mkdirs() }
