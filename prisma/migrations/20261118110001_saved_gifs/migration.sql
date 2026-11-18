-- «Мои GIF»: сохранённые пользователем GIF (до 200, свежие сверху). Своя запись File на тот
-- же объект хранилища, что у вложения-источника.
-- CreateTable
CREATE TABLE "saved_gifs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "source_file_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_gifs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_gifs_file_id_key" ON "saved_gifs"("file_id");

-- CreateIndex
CREATE INDEX "saved_gifs_user_id_created_at_idx" ON "saved_gifs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "saved_gifs_user_id_fingerprint_idx" ON "saved_gifs"("user_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "saved_gifs" ADD CONSTRAINT "saved_gifs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_gifs" ADD CONSTRAINT "saved_gifs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
