import type { EvidenceField } from './types';

export const ANNOTATION_KEYS = ['entryType', 'headword', 'meaning', 'stress', 'sourceMorphology', 'partOfSpeech', 'morphologyCandidates', 'declension', 'conjugation', 'aspect', 'aspectPairs', 'government', 'phraseUsage', 'sentenceAnalysis', 'examples', 'relatedWords', 'usageNotes', 'provenance', 'lemma', 'pronunciation', 'register', 'gender', 'animacy', 'number', 'conjugationType', 'reflexive', 'transitivity', 'collocations', 'commonErrors', 'rootRelations', 'synonyms', 'antonyms'] as const;
export type AnnotationKey = typeof ANNOTATION_KEYS[number];
export type AnnotationStatus = EvidenceField['status'] | 'missing';
export type ContentJobStatus = 'queued' | 'running' | 'completed' | 'completed-with-errors' | 'cancelled';
export interface ContentItemSummary {
  id: string; sourceKey: string; russian: string; chinese: string; book: number; lessons: number[];
  contentVersion: number; kind: string; fields: Partial<Record<AnnotationKey, AnnotationStatus>>;
}
export interface AnnotationRevisionDTO {
  id: string; itemId: string; fieldKey: AnnotationKey; actor: { id: string; name: string };
  action: 'generate' | 'approve' | 'reject' | 'rollback'; reason: string;
  before: EvidenceField | null; after: EvidenceField | null; version: number;
  jobId: string | null; rollbackOfId: string | null; createdAt: string;
}
export interface ContentItemDetail {
  item: ContentItemSummary; source: { raw: unknown; rowNumber: number; sourceVersion: number };
  fields: { key: AnnotationKey; evidence: EvidenceField | null; protected: boolean }[];
  revisions: AnnotationRevisionDTO[];
}
export const CONTENT_PARTS_OF_SPEECH = ['noun', 'adjective', 'verb', 'adverb', 'pronoun', 'numeral', 'preposition', 'conjunction', 'particle', 'interjection', 'participle', 'gerund', 'predicative', 'phrase', 'sentence', 'ambiguous', 'unknown'] as const;
export interface ContentListQuery { book?: number; lesson?: string; partOfSpeech?: string; field?: AnnotationKey; status?: AnnotationStatus; q?: string; offset?: number; limit?: number }
export interface ContentListResponse { items: ContentItemSummary[]; total: number; offset: number; limit: number }
export interface ContentCoverageDTO {
  totalItems: number; annotatedItems: number; totalFields: number; applicableFields: number; reviewedFields: number;
  statuses: Record<AnnotationStatus, number>;
  fields: { key: AnnotationKey; total: number; applicable: number; reviewed: number; statuses: Record<AnnotationStatus, number> }[];
  books: { book: number; totalItems: number; annotatedItems: number; applicableFields: number; reviewedFields: number }[];
  lessons: { lesson: string; totalItems: number; annotatedItems: number; applicableFields: number; reviewedFields: number }[];
  partsOfSpeech: { partOfSpeech: string; totalItems: number; annotatedItems: number; applicableFields: number; reviewedFields: number }[];
  providers: { id: 'local-dictionary' | 'cloud'; available: boolean; reason: string; costPerItemCents: number | null }[];
  artifact: { available: boolean; schemaVersion: string | null; generatorVersion: string | null; entries: number; datasetHash: string | null };
}
export interface ContentJobDTO {
  id: string; provider: string; status: ContentJobStatus; total: number; completed: number; failed: number; skipped: number;
  processed: number; remaining: number; costLimitCents: number; costSpentCents: number;
  datasetHash: string; schemaVersion: string; generatorVersion: string; selection: { books: number[]; fields: AnnotationKey[]; itemIds?: string[] };
  createdAt: string; updatedAt: string; finishedAt: string | null; busy: boolean;
  actor: { id: string; name: string };
}
export interface ContentJobDetail extends ContentJobDTO {
  failures: { id: string; itemId: string; sourceKey: string; attempts: number; error: string }[];
}
export interface CreateContentJobInput {
  requestKey: string; provider: 'local-dictionary' | 'cloud'; books?: number[]; fields?: AnnotationKey[]; itemIds?: string[]; costLimitCents: number;
}
export interface ReviewAnnotationInput {
  requestKey: string; baseVersion: number; action: 'approve' | 'reject'; reason: string;
  value?: unknown; source?: string; method?: string; acknowledge?: boolean;
}
export interface RollbackAnnotationInput { requestKey: string; baseVersion: number; reason: string }
export interface AnnotationMutationResult { item: ContentItemSummary; revision: AnnotationRevisionDTO; replayed: boolean }
