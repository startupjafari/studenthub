-- GIF как в Telegram: признак «анимация» у файла. GIF вложения чата медиа-воркер переводит в
-- беззвучный MP4 и ставит флаг; клиент показывает такой ролик как GIF (автоплей по кругу).
-- Старые строки получают false и показываются как раньше (image/gif).
-- AlterTable
ALTER TABLE "files" ADD COLUMN     "animation" BOOLEAN NOT NULL DEFAULT false;
