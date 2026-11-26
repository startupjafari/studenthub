-- Вход по ЭЦП НУЦ РК: привязка ключа к учётке (docs/PROJECT.md §8.3 «Вход по ЭЦП»).
-- Новая пустая таблица, существующие данные не трогает.
-- CreateTable
CREATE TABLE "user_eds_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "iin_hash" TEXT NOT NULL,
    "iin_last4" TEXT NOT NULL,
    "subject_cn" TEXT NOT NULL,
    "org_bin" TEXT,
    "cert_serial" TEXT NOT NULL,
    "cert_issuer" TEXT NOT NULL,
    "cert_not_after" TIMESTAMP(3) NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "user_eds_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_eds_credentials_user_id_key" ON "user_eds_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_eds_credentials_iin_hash_key" ON "user_eds_credentials"("iin_hash");

-- AddForeignKey
ALTER TABLE "user_eds_credentials" ADD CONSTRAINT "user_eds_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

