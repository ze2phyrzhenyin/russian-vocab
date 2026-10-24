-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "bookId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkbookImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coverage" TEXT NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceEntry" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "bookId" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "serial" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SourceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceEntryLesson" (
    "sourceEntryId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "SourceEntryLesson_pkey" PRIMARY KEY ("sourceEntryId","lessonId")
);

-- CreateTable
CREATE TABLE "SourceVersion" (
    "id" TEXT NOT NULL,
    "sourceEntryId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAsset" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "thumbnailFileName" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "SourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningItem" (
    "id" TEXT NOT NULL,
    "sourceEntryId" TEXT,
    "ownerId" TEXT,
    "russian" TEXT NOT NULL,
    "chinese" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'word',
    "morphology" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "example" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingMeaning" BOOLEAN NOT NULL DEFAULT false,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "meaningDisputed" BOOLEAN NOT NULL DEFAULT false,
    "annotations" JSONB,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCard" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,

    CONSTRAINT "LearningCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCardState" (
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "memory" JSONB NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCardState_pkey" PRIMARY KEY ("userId","cardId")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientSequence" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "practice" BOOLEAN NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3),
    "baseVersion" INTEGER NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "schedulerVersion" TEXT NOT NULL,
    "parametersVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "conflictReason" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeckItem" (
    "deckId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "DeckItem_pkey" PRIMARY KEY ("deckId","itemId")
);

-- CreateTable
CREATE TABLE "ItemFlag" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "suspended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemFlag_pkey" PRIMARY KEY ("userId","itemId")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_bookId_number_key" ON "Lesson"("bookId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEntry_sourceKey_key" ON "SourceEntry"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVersion_sourceEntryId_importId_key" ON "SourceVersion"("sourceEntryId", "importId");

-- CreateIndex
CREATE INDEX "LearningItem_ownerId_archived_idx" ON "LearningItem"("ownerId", "archived");

-- CreateIndex
CREATE INDEX "LearningItem_sourceEntryId_idx" ON "LearningItem"("sourceEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCard_itemId_direction_key" ON "LearningCard"("itemId", "direction");

-- CreateIndex
CREATE INDEX "UserCardState_userId_due_idx" ON "UserCardState"("userId", "due");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_receivedAt_idx" ON "ReviewEvent"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_userId_deviceId_clientSequence_key" ON "ReviewEvent"("userId", "deviceId", "clientSequence");

-- CreateIndex
CREATE INDEX "Deck_userId_idx" ON "Deck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_itemId_version_key" ON "ContentRevision"("itemId", "version");

-- CreateIndex
CREATE INDEX "OcrJob_userId_idx" ON "OcrJob"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEntry" ADD CONSTRAINT "SourceEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEntry" ADD CONSTRAINT "SourceEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEntryLesson" ADD CONSTRAINT "SourceEntryLesson_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "SourceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEntryLesson" ADD CONSTRAINT "SourceEntryLesson_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersion" ADD CONSTRAINT "SourceVersion_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "SourceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersion" ADD CONSTRAINT "SourceVersion_importId_fkey" FOREIGN KEY ("importId") REFERENCES "WorkbookImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "SourceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCard" ADD CONSTRAINT "LearningCard_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCardState" ADD CONSTRAINT "UserCardState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCardState" ADD CONSTRAINT "UserCardState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LearningCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LearningCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckItem" ADD CONSTRAINT "DeckItem_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckItem" ADD CONSTRAINT "DeckItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemFlag" ADD CONSTRAINT "ItemFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemFlag" ADD CONSTRAINT "ItemFlag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
