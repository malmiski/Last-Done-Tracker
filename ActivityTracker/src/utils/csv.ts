/**
 * CSV entry points, kept for compatibility with existing call sites.
 *
 * The implementation now lives in `backup`, which produces a single self
 * contained .zip (data.csv + images/) instead of one enormous CSV with base64
 * inlined in every row. That old format was itself an out-of-memory hazard:
 * exporting built the entire file as one JavaScript string before writing it.
 *
 * Import still accepts the legacy base64 CSV, so nothing previously exported
 * becomes unreadable.
 */
import { exportBundle, importBundle } from './backup';
import type { BackupProgress, ImportResult } from './backupTypes';

export type { BackupProgress, ImportResult };

/**
 * @deprecated Prefer `exportBundle`. Retained so older callers keep working;
 * both now produce the .zip bundle.
 */
export const downloadCsv = async (): Promise<void> => {
  await exportBundle();
};

/**
 * @deprecated Prefer `importBundle`. Accepts .zip bundles and CSV files,
 * including legacy CSVs with inline base64 images.
 */
export const uploadCsv = async (): Promise<void> => {
  const result = await importBundle();
  if (!result) return;

  const parts = [`Imported ${result.entriesImported} entries`];
  if (result.imagesImported > 0) parts.push(`${result.imagesImported} images`);
  if (result.imagesMissing > 0) parts.push(`${result.imagesMissing} images could not be restored`);
  alert(`${parts.join(', ')}.`);
};

export { exportBundle, importBundle };
