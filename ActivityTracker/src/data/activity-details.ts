export interface ActivityEntry {
  id: string;
  date: Date;
  notes?: string;
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
