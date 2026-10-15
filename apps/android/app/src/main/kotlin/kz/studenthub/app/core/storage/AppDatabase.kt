package kz.studenthub.app.core.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.immediateTransaction
import androidx.room.useWriterConnection
import java.time.Instant

/**
 * Локальная база. Она не кэш «на всякий случай», а источник правды для экранов: лента
 * и список читают только её, а сеть в неё пишет. Отсюда и мгновенность — экран не ждёт
 * сервера, чтобы что-то показать.
 *
 * Версия схемы и миграции — с первого релиза (`schemas/` в git): старая сборка живёт на
 * устройстве месяцами. Разрушающий сброс разрешён только как последний рубеж, если
 * миграции нет: кэш восстановится с сервера, а падение на старте — нет.
 */
@Database(
    entities = [
        ChatEntity::class,
        MessageEntity::class,
        DraftEntity::class,
        FolderEntity::class,
        FolderChatEntity::class,
        AttachmentEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun chats(): ChatDao

    abstract fun messages(): MessageDao

    abstract fun drafts(): DraftDao

    abstract fun folders(): FolderDao

    companion object {
        private const val NAME = "studenthub.db"

        fun onDisk(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, NAME)
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()
    }
}

/**
 * Транзакция записи. Новый API Room (соединение писателя): DAO внутри блока участвуют
 * в той же транзакции, а на JVM-тестах не нужен главный поток Android.
 */
suspend fun <R> AppDatabase.transaction(block: suspend () -> R): R =
    useWriterConnection { connection -> connection.immediateTransaction { block() } }

class Converters {
    @TypeConverter
    fun fromInstant(value: Instant?): Long? = value?.toEpochMilli()

    @TypeConverter
    fun toInstant(value: Long?): Instant? = value?.let(Instant::ofEpochMilli)

    @TypeConverter
    fun fromState(value: SendState): String = value.name

    @TypeConverter
    fun toState(value: String): SendState = runCatching { SendState.valueOf(value) }.getOrDefault(SendState.SENT)
}
