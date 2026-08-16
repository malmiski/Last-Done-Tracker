import React, { act } from 'react';
import renderer from 'react-test-renderer';
import ActivityHistoryItem from './ActivityHistoryItem';

jest.mock('../theme/theme', () => ({
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    subtext: '#666666',
    card: '#F0F0F0',
    primary: '#007AFF',
  },
}));

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

// `virtual` so the suite runs whether or not expo-image has been installed
// yet; the component only needs a renderable stand-in.
jest.mock(
  'expo-image',
  () => ({ Image: 'ExpoImage', clearMemoryCache: jest.fn() }),
  { virtual: true },
);

// The store is exercised directly in imageStore tests; here we only care that
// the component asks for the right variant and renders once a URI arrives.
jest.mock('../utils/imageStore', () => ({
  resolveImageUri: jest.fn((ref: string, variant: string) =>
    Promise.resolve(ref?.startsWith('img:') ? `file:///images/${ref.slice(4)}_${variant}.jpg` : null),
  ),
  clearMemoryCache: jest.fn(),
}));

// The first render in a jest-expo suite pays a one-off transform cost that can
// exceed the 5s default; every subsequent case runs in tens of milliseconds.
jest.setTimeout(20000);

const REF = 'img:abc123';
const date = new Date('2023-01-01T12:00:00Z');

const render = async (props: any) => {
  let tree: any;
  await act(async () => {
    tree = renderer.create(
      <ActivityHistoryItem
        startDate={date}
        endDate={date}
        onEdit={() => {}}
        onDelete={() => {}}
        {...props}
      />,
    );
  });
  // Let the async ref resolution settle.
  await act(async () => { await Promise.resolve(); });
  return tree;
};

describe('ActivityHistoryItem', () => {
  it('renders correctly with notes preview', async () => {
    const tree = await render({ notes: 'Test Note\nSecond Line' });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders correctly with lastEntryEndDate prop (blue text)', async () => {
    const tree = await render({
      startDate: new Date('2023-01-01T12:05:00Z'),
      endDate: new Date('2023-01-01T12:05:00Z'),
      lastEntryEndDate: new Date('2023-01-01T12:00:00Z'),
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders correctly with an image reference and small imageMode', async () => {
    const tree = await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'small' });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders correctly with an image reference and medium imageMode', async () => {
    const tree = await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'medium' });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders correctly with an image reference and large imageMode', async () => {
    const tree = await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'large' });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders nothing for images when imageMode is hidden', async () => {
    const tree = await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'hidden' });
    expect(JSON.stringify(tree.toJSON())).not.toContain('ExpoImage');
  });

  it('renders correctly without notes', async () => {
    const tree = await render({});
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('only renders the first line of multi-line notes', async () => {
    const tree = await render({ notes: 'Line 1\nLine 2\nLine 3' });
    expect(JSON.stringify(tree.toJSON())).toContain('Line 1');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Line 2');
  });

  it('renders duration when startDate and endDate differ', async () => {
    const tree = await render({
      startDate: new Date('2023-01-01T12:00:00Z'),
      endDate: new Date('2023-01-01T12:05:00Z'),
    });
    expect(JSON.stringify(tree.toJSON())).toContain('5 minutes');
  });

  it('requests the thumbnail variant for list tiles, never the full image', async () => {
    const imageStore = require('../utils/imageStore');
    imageStore.resolveImageUri.mockClear();

    await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'small' });

    // This is the regression that mattered: a 50pt tile must not pull the
    // full-size file, which is what made long lists explode.
    expect(imageStore.resolveImageUri).toHaveBeenCalledWith(REF, 'thumb');
    expect(imageStore.resolveImageUri).not.toHaveBeenCalledWith(REF, 'full');
  });
});
