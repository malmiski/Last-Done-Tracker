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
  {
    id: '6',
    name: 'Write in journal',
    lastDone: 'Never',
    icon: 'pencil',
  },
  {
    id: '7',
    name: 'Workout',
    lastDone: 'Never',
    icon: 'weight-lifter',
  },
  {
    id: '8',
    name: 'Clean the house',
    lastDone: 'Never',
    icon: 'broom',
  },
  {
    id: '9',
    name: 'Cook a healthy meal',
    lastDone: 'Never',
    icon: 'pot-mix',
  },
  {
    id: '10',
    name: 'Call a friend or family',
    lastDone: 'Never',
    icon: 'phone',
  },
  {
    id: '11',
    name: 'Water the plants',
    lastDone: 'Never',
    icon: 'flower',
  },
  {
    id: '12',
    name: 'Go for a swim',
    lastDone: 'Never',
    icon: 'swim',
  },
  {
    id: '13',
    name: 'Practice yoga',
    lastDone: 'Never',
    icon: 'yoga',
  },
  {
    id: '14',
    name: 'Go grocery shopping',
    lastDone: 'Never',
    icon: 'cart',
  },
  {
    id: '15',
    name: 'Work on a side project',
    lastDone: 'Never',
    icon: 'code-tags',
  },
];
