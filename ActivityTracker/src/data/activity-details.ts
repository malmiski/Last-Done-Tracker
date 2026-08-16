export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ActivityEntry {
  id: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  /**
   * Image references, not image data. Each element is either "img:<id>"
   * addressing a blob in the image store, a "legacy:<entryId>" placeholder for
   * a row that has not been migrated yet, or — on old rows read directly —
   * inline base64. Always resolve through `utils/imageStore.resolveImageUri`
   * rather than passing these to <Image> yourself.
   */
  images?: string[];
  /** Thumbnail references, parallel to `images`. */
  thumbnails?: string[];
  /** True when the row has image data, even if it was too large to load. */
  hasImages?: boolean;
  /** False while the row still holds inline base64 awaiting migration. */
  imagesMigrated?: boolean;
  tags?: Tag[];
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
