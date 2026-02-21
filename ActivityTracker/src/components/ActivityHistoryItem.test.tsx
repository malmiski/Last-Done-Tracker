import React, { act } from 'react';
import renderer from 'react-test-renderer';
import ActivityHistoryItem from './ActivityHistoryItem';

// Mock theme
jest.mock('../theme/theme', () => ({
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    subtext: '#666666',
    card: '#F0F0F0',
    primary: '#007AFF',
  },
}));

// Mock Icon
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

describe('ActivityHistoryItem', () => {
  it('renders correctly with notes preview', async () => {
    const date = new Date('2023-01-01T12:00:00Z');
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ActivityHistoryItem
          date={date}
          notes={"Test Note\nSecond Line"}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      );
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders correctly without notes', async () => {
    const date = new Date('2023-01-01T12:00:00Z');
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ActivityHistoryItem
          date={date}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      );
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('only renders the first line of multi-line notes', async () => {
    const date = new Date('2023-01-01T12:00:00Z');
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ActivityHistoryItem
          date={date}
          notes={"Line 1\nLine 2\nLine 3"}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      );
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON()).toMatchSnapshot();
  });
});
