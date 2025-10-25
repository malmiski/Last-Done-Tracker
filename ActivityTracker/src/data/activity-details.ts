export interface ActivityEntry {
  id: string;
  date: Date;
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
