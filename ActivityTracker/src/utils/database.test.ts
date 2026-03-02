import * as database from './database';
import * as SQLite from 'expo-sqlite';

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
}));

// Mock other modules in database.ts
jest.mock('expo-file-system', () => ({
    documentDirectory: 'mock-dir/',
    cacheDirectory: 'mock-cache/',
    getInfoAsync: jest.fn(),
    copyAsync: jest.fn(),
    makeDirectoryAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
    shareAsync: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({
    getDocumentAsync: jest.fn(),
}));

// Mock Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

describe('Database Tags CRUD', () => {
  const mockDb = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(() => {
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockDb);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should add and get tags', async () => {
    const tag = { id: 't1', name: 'Workout', color: 'green' };
    mockDb.getAllAsync.mockResolvedValue([tag]);

    await database.addTag(tag);
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tags'),
      ['t1', 'Workout', 'green']
    );

    const tags = await database.getTags();
    expect(tags).toEqual([tag]);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM tags'));
  });

  it('should update a tag', async () => {
    const tag = { id: 't1', name: 'Exercise', color: 'blue' };
    await database.updateTag(tag);
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tags SET name = ?, color = ? WHERE id = ?'),
      ['Exercise', 'blue', 't1']
    );
  });

  it('should delete a tag', async () => {
    await database.deleteTag('t1');
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tags WHERE id = ?'),
      ['t1']
    );
  });

  it('should get entry tags', async () => {
    const tag = { id: 't1', name: 'Workout', color: 'green' };
    mockDb.getAllAsync.mockResolvedValue([tag]);

    const entryTags = await database.getEntryTags('e1');
    expect(entryTags).toEqual([tag]);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('SELECT tags.* FROM tags JOIN entry_tags'),
        ['e1']
    );
  });

  it('should get tag usage count', async () => {
    mockDb.getFirstAsync.mockResolvedValue({ count: 5 });
    const count = await database.getTagUsageCount('t1');
    expect(count).toBe(5);
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count FROM entry_tags WHERE tagId = ?'),
        ['t1']
    );
  });
});
