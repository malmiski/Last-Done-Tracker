/** Shared types for the backup bundle, so native and web agree on the shape. */

export interface BackupProgress {
  phase: 'entries' | 'images' | 'database' | 'finalising' | 'reading' | 'restoring';
  completed: number;
  /** 0 when the total is not known yet (for example while walking entries). */
  total: number;
}

export type ProgressCallback = (progress: BackupProgress) => void;

export interface ImportResult {
  entriesImported: number;
  imagesImported: number;
  /** Filenames the CSV referenced that were not present in the archive. */
  imagesMissing: number;
}
