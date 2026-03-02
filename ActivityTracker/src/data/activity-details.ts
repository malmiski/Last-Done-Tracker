export interface ActivityEntry {
  id: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  image?: string; // base64 encoded image
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
