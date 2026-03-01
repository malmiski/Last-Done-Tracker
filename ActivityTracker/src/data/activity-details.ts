export interface ActivityEntry {
  id: string;
  date: Date;
  notes?: string;
  image?: string; // base64 encoded image
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
