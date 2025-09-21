export interface Activity {
  id: string;
  name: string;
  lastDone: string;
  icon: string;
}

export const activities: Activity[] = [
  {
    id: '1',
    name: 'Morning Run',
    lastDone: '2 days ago',
    icon: 'run',
  },
  {
    id: '2',
    name: 'Meditation',
    lastDone: '1 week ago',
    icon: 'meditation',
  },
  {
    id: '3',
    name: 'Reading',
    lastDone: '3 weeks ago',
    icon: 'book-open-variant',
  },
  {
    id: '4',
    name: 'Guitar Practice',
    lastDone: '2 months ago',
    icon: 'guitar-acoustic',
  },
  {
    id: '5',
    name: 'Spanish Lesson',
    lastDone: '6 months ago',
    icon: 'earth',
  },
];
