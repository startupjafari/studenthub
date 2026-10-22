-- CreateEnum
CREATE TYPE "BookCopyStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ON_LOAN', 'LOST', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "BookCondition" AS ENUM ('GOOD', 'WORN', 'DAMAGED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('OPEN', 'RETURNED', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('QUEUED', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "library_settings" (
    "university_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_loan_days" INTEGER NOT NULL DEFAULT 14,
    "max_loan_days" INTEGER NOT NULL DEFAULT 120,
    "max_active_loans" INTEGER NOT NULL DEFAULT 5,
    "max_active_reservations" INTEGER NOT NULL DEFAULT 3,
    "reservation_hold_days" INTEGER NOT NULL DEFAULT 3,
    "max_renewals" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("university_id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '',
    "isbn" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "section" TEXT,
    "description" TEXT,
    "cover_file_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "inventory_number" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BookCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "BookCondition" NOT NULL DEFAULT 'GOOD',
    "note" TEXT,
    "inventoried_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "copy_id" TEXT NOT NULL,
    "reader_id" TEXT,
    "issued_by_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "renewals" INTEGER NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'OPEN',
    "returned_at" TIMESTAMP(3),
    "returned_to_id" TEXT,
    "return_condition" "BookCondition",
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancel_reason" TEXT,
    "disputed_at" TIMESTAMP(3),
    "reader_name" TEXT NOT NULL,
    "reader_group" TEXT,
    "reader_card" TEXT,
    "book_title" TEXT NOT NULL,
    "inventory_number" TEXT NOT NULL,
    "due_soon_sent_at" TIMESTAMP(3),
    "due_today_sent_at" TIMESTAMP(3),
    "overdue_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "reader_id" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'QUEUED',
    "copy_id" TEXT,
    "ready_at" TIMESTAMP(3),
    "hold_until" TIMESTAMP(3),
    "loan_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_id_access_logs" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "loan_id" TEXT,
    "librarian_id" TEXT,
    "librarian_name" TEXT NOT NULL,
    "reader_id" TEXT,
    "reader_name" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_id_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "library_settings_updated_by_id_idx" ON "library_settings"("updated_by_id");

-- CreateIndex
CREATE INDEX "books_university_id_archived_at_title_idx" ON "books"("university_id", "archived_at", "title");

-- CreateIndex
CREATE INDEX "books_university_id_isbn_idx" ON "books"("university_id", "isbn");

-- CreateIndex
CREATE INDEX "books_cover_file_id_idx" ON "books"("cover_file_id");

-- CreateIndex
CREATE INDEX "books_created_by_id_idx" ON "books"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_code_key" ON "book_copies"("code");

-- CreateIndex
CREATE INDEX "book_copies_book_id_status_idx" ON "book_copies"("book_id", "status");

-- CreateIndex
CREATE INDEX "book_copies_university_id_status_idx" ON "book_copies"("university_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_university_id_inventory_number_key" ON "book_copies"("university_id", "inventory_number");

-- CreateIndex
CREATE INDEX "loans_university_id_status_due_at_idx" ON "loans"("university_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "loans_reader_id_status_idx" ON "loans"("reader_id", "status");

-- CreateIndex
CREATE INDEX "loans_copy_id_issued_at_idx" ON "loans"("copy_id", "issued_at");

-- CreateIndex
CREATE INDEX "loans_issued_by_id_idx" ON "loans"("issued_by_id");

-- CreateIndex
CREATE INDEX "loans_returned_to_id_idx" ON "loans"("returned_to_id");

-- CreateIndex
CREATE INDEX "loans_cancelled_by_id_idx" ON "loans"("cancelled_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_loan_id_key" ON "reservations"("loan_id");

-- CreateIndex
CREATE INDEX "reservations_book_id_status_created_at_idx" ON "reservations"("book_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reservations_reader_id_status_idx" ON "reservations"("reader_id", "status");

-- CreateIndex
CREATE INDEX "reservations_university_id_status_hold_until_idx" ON "reservations"("university_id", "status", "hold_until");

-- CreateIndex
CREATE INDEX "reservations_copy_id_idx" ON "reservations"("copy_id");

-- CreateIndex
CREATE INDEX "library_id_access_logs_university_id_created_at_idx" ON "library_id_access_logs"("university_id", "created_at");

-- CreateIndex
CREATE INDEX "library_id_access_logs_loan_id_idx" ON "library_id_access_logs"("loan_id");

-- CreateIndex
CREATE INDEX "library_id_access_logs_librarian_id_idx" ON "library_id_access_logs"("librarian_id");

-- CreateIndex
CREATE INDEX "library_id_access_logs_reader_id_idx" ON "library_id_access_logs"("reader_id");

-- AddForeignKey
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_cover_file_id_fkey" FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_returned_to_id_fkey" FOREIGN KEY ("returned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_id_access_logs" ADD CONSTRAINT "library_id_access_logs_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_id_access_logs" ADD CONSTRAINT "library_id_access_logs_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_id_access_logs" ADD CONSTRAINT "library_id_access_logs_librarian_id_fkey" FOREIGN KEY ("librarian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_id_access_logs" ADD CONSTRAINT "library_id_access_logs_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

