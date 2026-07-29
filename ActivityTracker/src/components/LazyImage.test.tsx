import React, { act } from 'react';
import renderer from 'react-test-renderer';
import LazyImage from './LazyImage';
import { Platform } from 'react-native';

describe('LazyImage', () => {
  const originalOS = Platform.OS;

  beforeAll(() => {
    if (typeof window !== 'undefined') {
      (window as any).IntersectionObserver = class {
        observe() {}
        disconnect() {}
      };
    } else {
      (global as any).window = {
        IntersectionObserver: class {
          observe() {}
          disconnect() {}
        }
      };
    }
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('renders standard Image directly when not on web', async () => {
    Platform.OS = 'ios';
    let tree;
    await act(async () => {
      tree = renderer.create(
        <LazyImage
          source={{ uri: 'https://example.com/test.jpg' }}
          style={{ width: 100, height: 100 }}
        />
      );
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON().type).toBe('Image');
  });

  it('renders placeholder View when on web and not visible', async () => {
    Platform.OS = 'web';
    let tree;
    await act(async () => {
      tree = renderer.create(
        <LazyImage
          source={{ uri: 'https://example.com/test.jpg' }}
          style={{ width: 100, height: 100 }}
        />
      );
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.toJSON().type).toBe('div');
  });
});
