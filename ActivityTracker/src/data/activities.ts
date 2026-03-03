export interface Activity {
  id: string;
  name: string;
  lastDone: string;
  icon: string;
  orderIndex: number;
}

export const activities: Activity[] = [];
