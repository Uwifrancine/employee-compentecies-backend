-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "job_title_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
