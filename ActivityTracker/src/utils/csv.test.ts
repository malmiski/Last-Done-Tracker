import AsyncStorage from '@react-native-async-storage/async-storage';
import { downloadCsv, uploadCsv } from './csv';
import * as DocumentPicker from 'expo-document-picker';

// Mocking dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
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

  it('should include notes in exported CSV', async () => {
    const activities = [{ id: '1', name: 'Test', icon: 'run' }];
    const details = { '1': [{ id: 'e1', date: new Date('2023-01-01T12:00:00Z'), notes: 'Test Note' }] };

    (AsyncStorage.getItem as jest.Mock)
      .mockResolvedValueOnce(JSON.stringify(activities))
      .mockResolvedValueOnce(JSON.stringify(details));

    await downloadCsv();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('@activities');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('@activityDetails');
    expect(document.createElement).toHaveBeenCalledWith('a');
  });

  it('should import notes from CSV', async () => {
    const csvContent = 'Activity,Icon,Date,Notes\nTest,run,2023-01-01T12:00:00Z,"Test Note with , comma"';

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ file: {} }] // mock file object
    });

    (AsyncStorage.getItem as jest.Mock)
      .mockResolvedValueOnce(JSON.stringify([])) // activities
      .mockResolvedValueOnce(JSON.stringify({})); // activityDetails

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

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@activities', expect.stringContaining('Test'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@activityDetails', expect.stringContaining('Test Note with , comma'));
  });
});
