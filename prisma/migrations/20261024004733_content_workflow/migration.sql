-- CreateTable
CREATE TABLE "ContentJob" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'local-dictionary',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "datasetHash" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "costLimitCents" INTEGER NOT NULL DEFAULT 0,
    "costSpentCents" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "candidate" JSONB NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationRevision" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "jobId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "version" INTEGER NOT NULL,
    "requestKey" TEXT,
    "rollbackOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnotationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentJob_requestKey_key" ON "ContentJob"("requestKey");

-- CreateIndex
CREATE INDEX "ContentJob_status_createdAt_idx" ON "ContentJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentJobItem_jobId_status_idx" ON "ContentJobItem"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentJobItem_jobId_itemId_key" ON "ContentJobItem"("jobId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationRevision_requestKey_key" ON "AnnotationRevision"("requestKey");

-- CreateIndex
CREATE INDEX "AnnotationRevision_itemId_fieldKey_createdAt_idx" ON "AnnotationRevision"("itemId", "fieldKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationRevision_itemId_fieldKey_version_key" ON "AnnotationRevision"("itemId", "fieldKey", "version");

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJobItem" ADD CONSTRAINT "ContentJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ContentJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJobItem" ADD CONSTRAINT "ContentJobItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationRevision" ADD CONSTRAINT "AnnotationRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationRevision" ADD CONSTRAINT "AnnotationRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationRevision" ADD CONSTRAINT "AnnotationRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ContentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
