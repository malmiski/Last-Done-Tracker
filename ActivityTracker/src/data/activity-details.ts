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
  images?: string[]; // base64 encoded image
  thumbnails?: string[]; // base64 encoded smaller image
  tags?: Tag[];
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
