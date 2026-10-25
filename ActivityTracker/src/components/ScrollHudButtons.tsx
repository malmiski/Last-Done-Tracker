import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

export const JUMP_SCROLL_DURATION_MS = 1500;

/**
 * Smoothly interpolates a scroll offset over `durationMs` using
 * requestAnimationFrame before swapping in a distant page.
 */
export const animateScrollOffset = (
  setOffset: (offset: number) => void,
  fromOffset: number,
  toOffset: number,
  durationMs = JUMP_SCROLL_DURATION_MS,
): Promise<void> => {
  return new Promise(resolve => {
    if (durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      setOffset(toOffset);
      resolve();
      return;
    }

    const startTime = Date.now();
    const step = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const current = fromOffset + (toOffset - fromOffset) * eased;
      setOffset(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };

    requestAnimationFrame(step);
  });
};

interface ScrollHudButtonsProps {
  onPressTop: () => void;
  onPressBottom: () => void;
  /**
   * Vertical offset from the bottom edge. Defaults to 45 so the 50pt buttons
   * share the exact horizontal center line (bottom: 70) of a 60pt FAB placed
   * at bottom: 40.
   */
  bottom?: number;
}

/**
 * Translucent floating "Go to Top" (bottom-left) and "Go to Bottom"
 * (bottom-right) HUD buttons for scrollable screens.
 */
const ScrollHudButtons: React.FC<ScrollHudButtonsProps> = ({
  onPressTop,
  onPressBottom,
  bottom = 45,
}) => {
  return (
    <View style={[styles.container, { bottom }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.button}
        onPress={onPressTop}
        activeOpacity={0.7}
        accessibilityLabel="Go to top"
        testID="scroll-to-top-button"
      >
        <Icon name="arrow-up" size={24} color={theme.colors.text} style={styles.icon} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.button}
        onPress={onPressBottom}
        activeOpacity={0.7}
        accessibilityLabel="Go to bottom"
        testID="scroll-to-bottom-button"
      >
        <Icon name="arrow-down" size={24} color={theme.colors.text} style={styles.icon} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 100,
  },
  button: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(44, 44, 46, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  icon: {
    opacity: 0.9,
  },
});

export default ScrollHudButtons;
