export interface ActivityEntry {
  id: string;
  date: Date;
}

export const activityDetails: { [key: string]: ActivityEntry[] } = {
  '1': [
    { id: '101', date: new Date('2023-10-26T10:30:15') },
    { id: '102', date: new Date('2023-10-19T09:15:00') },
    { id: '103', date: new Date('2023-10-12T11:45:30') },
    { id: '104', date: new Date('2023-10-05T20:00:10') },
    { id: '105', date: new Date('2023-09-28T09:20:45') },
    { id: '106', date: new Date('2023-09-21T10:05:55') },
    { id: '107', date: new Date('2023-09-14T07:30:00') },
    { id: '108', date: new Date('2023-09-07T21:00:12') },
  ],
  '2': [
    { id: '201', date: new Date('2023-10-25T08:00:00') },
  ],
  '3': [],
  '4': [],
  '5': [],
};
