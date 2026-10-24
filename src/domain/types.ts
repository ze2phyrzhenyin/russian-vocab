export type Direction = 'ru-zh' | 'zh-ru' | 'recall';
export type RatingName = 'again' | 'hard' | 'good' | 'easy';
export type ItemKind = 'word' | 'phrase' | 'sentence';
export interface EvidenceField {
  value: unknown;
  status: 'source' | 'generated' | 'reviewed' | 'unknown' | 'disputed' | 'not-applicable' | 'rejected';
  source?: string;
  method?: string;
  version?: string;
  updatedAt?: string;
}
export interface LearningItemDTO {
  id: string;
  russian: string;
  chinese: string;
  searchKey: string;
  kind: ItemKind;
  morphology: string;
  notes: string;
  book: number | null;
  lessons: number[];
  sourceEntryId: string | null;
  documentId: string | null;
  bookPage: string;
  pdfPage: string;
  assetIds: string[];
  missingMeaning: boolean;
  disputed: boolean;
  meaningDisputed?: boolean;
  contentVersion: number;
  annotations: Record<string, EvidenceField> | null;
  favorite?: boolean;
  suspended?: boolean;
  example?: string;
  tags?: string[];
}
export interface SerializedCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
  learning_steps: number;
}
export interface CardStateDTO {
  version: number;
  card: SerializedCard;
  flag?: string;
}
export interface ReviewEventInput {
  id: string;
  deviceId: string;
  sessionId: string;
  clientSequence: number;
  cardId: string;
  itemId: string;
  direction: Direction;
  rating: RatingName;
  correct: boolean;
  practice: boolean;
  occurredAt: string;
  baseVersion: number;
  contentVersion: number;
  schedulerVersion: string;
  parametersVersion: string;
  answer?: string;
  mode?: 'choice' | 'recall';
  hinted?: boolean;
}
export interface SyncResponse {
  acceptedIds: string[];
  conflicts: { id: string; reason: string }[];
  states: Record<string, CardStateDTO>;
  resetCardIds?: string[];
}
export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: string;
  timeZone: string;
}
export interface LessonDTO { id: string; number: number; count: number; eligibleCount: number }
export interface BookDTO { id: number; title: string; entryCount: number; lessons: LessonDTO[] }
export interface StatsDTO { learned: number; due: number; mistakes: number; today: number; streak: number; newToday?:number; day?:string }
export interface BootstrapDTO {
  user: UserDTO;
  demoMode: boolean;
  stats: StatsDTO;
  selection: { lessonIds: string[]; dailyGoal: number };
  books: BookDTO[];
}
export interface ItemsResponse {
  items: LearningItemDTO[];
  states: Record<string, CardStateDTO>;
  total: number;
}
export interface DeckDTO { id: string; name: string; category: string; count: number }
