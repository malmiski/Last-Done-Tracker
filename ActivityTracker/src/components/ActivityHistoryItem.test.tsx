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

// Sizes are covered in imageDimensions.test and entryRowLayout.test; here the
// point is only that a row renders, so nothing should reach the database.
jest.mock('../utils/imageDimensions', () => ({
  knownDimensions: () => null,
  rememberDimensions: jest.fn(),
}));

// `virtual` so the suite runs whether or not expo-image has been installed
// yet; the component only needs a renderable stand-in.
jest.mock(
  'expo-image',
  () => ({ Image: 'ExpoImage', clearMemoryCache: jest.fn() }),
  { virtual: true },
);

// The store is exercised directly in imageStore.pool.test; here we only care
// that the component asks for the right variant and renders once a URI arrives.
jest.mock('../utils/imageStore', () => ({
  acquireImageUri: jest.fn((ref: string, variant: string) =>
    Promise.resolve(
      ref?.startsWith('img:')
        ? { uri: `file:///images/${ref.slice(4)}_${variant}.jpg`, key: null }
        : null,
    ),
  ),
  releaseImageUri: jest.fn(),
  resolveImageUri: jest.fn(),
  clearMemoryCache: jest.fn(),
  getCacheEpoch: jest.fn(() => 0),
  subscribeToCacheEpoch: jest.fn(() => () => {}),
  // Returns null so the gallery uses its fallback height. Header parsing is
  // covered directly in jpegSize.test.
  getImageSize: jest.fn(() => Promise.resolve(null)),
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

/** Every string the tree renders, in order, joined. */
const renderedText = (tree: any): string => {
  const out: string[] = [];
  const walk = (node: any) => {
    if (node == null) return;
    if (typeof node === 'string') return void out.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node.children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out.join('');
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

  it('shows the entry number when one is supplied', async () => {
    // Reads the rendered text rather than the serialised tree: style values
    // are colour literals, so a raw string search for "#" matches those too.
    expect(renderedText(await render({ index: 42 }))).toContain('#42');
  });

  it('shows no number when none is supplied', async () => {
    expect(renderedText(await render({}))).not.toMatch(/#\d/);
  });

  it('renders every tag in full, however many there are', async () => {
    // The strip used to let pills shrink to fit the row, which squeezed each
    // one down to a letter or two. It scrolls sideways instead now, so a long
    // tag name survives intact.
    const tags = [
      { id: 't1', name: 'Gardening', color: '#4CAF50' },
      { id: 't2', name: 'Cleaning', color: '#4CAF50' },
      { id: 't3', name: 'Food', color: '#9C27B0' },
      { id: 't4', name: 'Deliberately Quite A Long Tag Name', color: '#F44336' },
    ];

    const text = renderedText(await render({ tags }));
    tags.forEach(tag => expect(text).toContain(tag.name));
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
    imageStore.acquireImageUri.mockClear();

    await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'small' });

    // This is the regression that mattered: a 50pt tile must not pull the
    // full-size file, which is what made long lists explode.
    expect(imageStore.acquireImageUri).toHaveBeenCalledWith(REF, 'thumb');
    expect(imageStore.acquireImageUri).not.toHaveBeenCalledWith(REF, 'full');
  });

  it('releases its hold on the URL when unmounted', async () => {
    const imageStore = require('../utils/imageStore');
    imageStore.releaseImageUri.mockClear();

    const tree = await render({ entryId: 'e1', images: [REF], thumbnails: [REF], imageMode: 'small' });
    await act(async () => { tree.unmount(); });

    // Without this the pool would never reclaim off-screen images.
    expect(imageStore.releaseImageUri).toHaveBeenCalled();
  });
});
