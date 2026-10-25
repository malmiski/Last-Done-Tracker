import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import ScrollHudButtons, { animateScrollOffset } from './ScrollHudButtons';

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

describe('ScrollHudButtons', () => {
  it('renders Go to top (left) and Go to bottom (right) buttons and invokes handlers', () => {
    const onPressTop = jest.fn();
    const onPressBottom = jest.fn();

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ScrollHudButtons onPressTop={onPressTop} onPressBottom={onPressBottom} />
      );
    });

    const buttons = tree.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.accessibilityLabel).toBe('Go to top');
    expect(buttons[1].props.accessibilityLabel).toBe('Go to bottom');

    act(() => {
      buttons[0].props.onPress();
      buttons[1].props.onPress();
    });

    expect(onPressTop).toHaveBeenCalledTimes(1);
    expect(onPressBottom).toHaveBeenCalledTimes(1);
  });

  it('animateScrollOffset steps smoothly from startOffset to targetOffset', async () => {
    const offsets: number[] = [];
    await animateScrollOffset(offset => offsets.push(offset), 0, 300, 60);
    expect(offsets.length).toBeGreaterThan(0);
    expect(offsets[offsets.length - 1]).toBe(300);
  });
});
