import { downloadCsv, uploadCsv } from './csv';
import * as DocumentPicker from 'expo-document-picker';
import * as database from './database';

// Mocking dependencies
jest.mock('./database', () => ({
  getActivities: jest.fn(),
  getEntries: jest.fn(),
  addActivity: jest.fn(),
  updateActivity: jest.fn(),
  addEntry: jest.fn(),
  updateEntry: jest.fn(),
  getTags: jest.fn(),
  addTag: jest.fn(),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    write: jest.fn(),
    text: jest.fn(),
  })),
  Paths: { cache: 'cache' },
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

// Mock global objects
(global as any).alert = jest.fn();
(global as any).document = {
  createElement: jest.fn().mockReturnValue({
    setAttribute: jest.fn(),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    click: jest.fn(),
  }),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn(),
  },
};
(global as any).URL = {
  createObjectURL: jest.fn().mockReturnValue('mock-url'),
};

describe('CSV Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should include IDs and tags in exported CSV', async () => {
    const activities = [{ id: '1', name: 'Test', icon: 'run', lastDone: 'Never' }];
    const entries = [{
        id: 'e1',
        startDate: new Date('2023-01-01T12:00:00Z'),
        endDate: new Date('2023-01-01T12:00:00Z'),
        notes: 'Test Note',
        image: 'data:image/jpeg;base64,mock',
        tags: [{ id: 't1', name: 'Tag1', color: 'red' }]
    }];

    (database.getActivities as jest.Mock).mockResolvedValue(activities);
    (database.getEntries as jest.Mock).mockResolvedValue(entries);
    (database.getTags as jest.Mock).mockResolvedValue([{ id: 't1', name: 'Tag1', color: 'red' }]);

    await downloadCsv();
    expect(database.getActivities).toHaveBeenCalled();
    expect(database.getEntries).toHaveBeenCalledWith('1');
    expect(document.createElement).toHaveBeenCalledWith('a');
  });

  it('should import from CSV with IDs and tags', async () => {
    const csvContent = 'ActivityID,Activity,Icon,EntryID,StartDate,EndDate,Notes,Image,Tags\n1,Test,run,e1,2023-01-01T12:00:00Z,2023-01-01T12:00:00Z,"Test Note","data:image/jpeg;base64,mock",Tag1|Tag2';

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ file: {} }] // mock file object
    });

    (database.getActivities as jest.Mock).mockResolvedValue([]);
    (database.getEntries as jest.Mock).mockResolvedValue([]);
    (database.getTags as jest.Mock).mockResolvedValue([]);

    // Mock FileReader for web
    const mockFileReader = {
      readAsText: jest.fn().mockImplementation(function() {
        this.onload();
      }),
      result: csvContent,
      onload: null,
    };
    (global as any).FileReader = jest.fn(() => mockFileReader);

    await uploadCsv();

    expect(database.addActivity).toHaveBeenCalledWith(expect.objectContaining({ id: '1', name: 'Test' }));
    expect(database.addTag).toHaveBeenCalledTimes(2); // Tag1 and Tag2
    expect(database.addEntry).toHaveBeenCalledWith('1', expect.objectContaining({
        id: 'e1',
        notes: 'Test Note',
        tags: expect.arrayContaining([
            expect.objectContaining({ name: 'Tag1' }),
            expect.objectContaining({ name: 'Tag2' })
        ])
    }));
  });
});
