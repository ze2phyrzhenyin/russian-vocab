# Shared contract v1

Root owns src/domain/types.ts, Prisma schema/migrations, package/lockfile, server APIs. Other agents own only assigned paths.

## Workbook extraction (Python -> JSON -> database)

Importer writes data/processed/workbook.json with top-level {schemaVersion:1, workbook:{sha256,fileName,byteSize,sheets,coverageNotes:string[]}, entries:SourceRow[], assets:SourceImage[], report:object}. It preserves actual source without revising it.

SourceRow = {sourceKey:string, rowNumber:number, serial:string, book:number, lessons:number[], lessonRaw:string, russian:string, chinese:string, morphology:string, bookPage:string, pdfPage:string, originalLinkFormula:string, sourceLabel:string, notes:string, searchOriginal:string, rawColumns:Record<string,string>, documentId:string, assetIds:string[], missingMeaning:boolean, disputed:boolean}. sourceKey is a persistent source mapping identifier based on book + serial, NOT file hash or Russian alone. If serial is globally sequential, still include book. Changes in serial/identity are reported for human reconciliation, not silently linked by Russian. Root imports stable UUID ids and versioned source content keyed by sourceKey; no deletion of user history.

SourceImage = {id:string, fileName:string, thumbnailFileName:string|null, sha256:string, sheet:string, anchorRow:number, anchorCol:number, titles:string[], documentId:string|null}. Paths are relative to data/assets. All 108 image objects retained. Source row formula targets mapped via worksheet cells/title anchors to drawing positions, with unmapped entries failing extraction/report. Full images and thumbnails separated; do not put them in public/.

Report includes source rows, per-book/per-lesson counts, association count, missing Chinese entries, flagged disputes, all image objects, unique referenced anchors, unmapped rows, extra unreferenced images and coverage limitations. First extraction baseline is observed, not fabricated to match provided figures.

## App serialization

LearningItemDTO: id, russian, chinese, searchKey, kind (word|phrase|sentence), morphology, notes, book:number|null, lessons:number[], sourceEntryId:string|null, documentId:string|null, bookPage, pdfPage, assetIds:string[], missingMeaning, disputed, contentVersion:number, annotations:object|null.

Card identity = learningItem.id + direction (ru-zh|zh-ru|recall). SourceEntry and LearningItem 1:1 initially; no automatic lexeme/sense merging. Siblings share item, not scheduling state. Source joins use many-to-many lessons. Personal items have ownerId and their own stable IDs.

Review events carry id, userId assigned server-side, deviceId, sessionId, clientSequence, cardId, itemId, direction, rating (again|hard|good|easy), correct:boolean, practice:boolean, occurredAt ISO, baseVersion:number, contentVersion:number, schedulerVersion, parametersVersion. Server assigns receivedAt, validates access, transactionally deduplicates and checks state version; conflict is retained explicitly, never overwritten silently. Invalid/future timestamps do not reorder authoritative history.

Domain engine must expose deterministic functions for search normalization (retain ё and й), conservative unique-answer questions/fallback, bounded mistake queues, FSRS serialization and rating adaptation. No DB/network dependencies inside domain.

## API route contract (root implements)

- GET /api/bootstrap -> {user:{id,name,email,role,timeZone},demoMode,stats:{learned,due,mistakes,today,streak},selection:{lessonIds:string[],dailyGoal:number},books:[{id:number,title,entryCount,lessons:[{id:string,number:number,count:number,eligibleCount:number}]}]}
- GET /api/items?lessons=1-1,1-2&q=...&deckId=...&filter=all|new|due|mistakes|favorites|suspended -> {items:LearningItemDTO[],states:Record<cardId,{version,card:serializedFSRS,flag?:string}>,total}; maximum combined 1000 items, paginated when browsing larger ranges.
- GET /api/items/:id -> {item:LearningItemDTO,revisions:object[]}; POST /api/items/:id/favorite -> {favorite:boolean}; POST /api/items/:id/suspend -> {suspended:boolean}
- POST /api/preferences {lessonIds,dailyGoal,timeZone?} -> saved preferences
- POST /api/reviews {events:ReviewEvent[]} -> {acceptedIds:string[],conflicts:[{id,reason}],states:Record<cardId,{version,card}>}. Both accepted and conflicted are persisted; outbox only deletes accepted IDs.
- GET /api/decks -> {decks:[{id,name,category,count}]}; POST /api/decks {name,category?}; PATCH/DELETE /api/decks/:id.
- POST /api/decks/:id/items {items:[{russian,chinese,kind,notes?,example?,tags?}],existingItemIds?:string[]} -> {items}; PATCH/DELETE /api/decks/:id/items/:itemId for private items/membership.
- GET /api/history -> {events,stats}; GET /api/admin/issues -> {issues,report}; POST /api/admin/revisions {itemId,chinese?,notes?,reason} -> revision (admin only).
- GET /api/assets/:id?thumbnail=1 -> authenticated original image/thumbnail; ownership-aware when personal assets added.
- Better Auth /api/auth/* (email/password). GET /api/config -> {demoMode:boolean}. Demo login calls real signIn.email. Core does not need AI key.

UI uses API helpers plus Dexie for account-isolated downloaded lesson DTOs, sessions and outbox. Root/learning agent will coordinate exact exported domain signatures. UI can start with shared types and provide callbacks until integration.
