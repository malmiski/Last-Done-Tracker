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
  image?: string; // base64 encoded image
  tags?: Tag[];
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {};
