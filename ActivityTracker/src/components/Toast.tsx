/**
 * A small anchored confirmation pill.
 *
 * Used for actions whose result is otherwise invisible — copying an entry
 * changes nothing on screen, so without feedback you cannot tell it worked.
 * An Alert would be too heavy for that: it interrupts, and it needs
 * dismissing for something you already know the outcome of.
 *
 * Deliberately self-contained rather than using react-native-root-toast
 * (already a dependency, but unused): this anchors under the header buttons
 * that triggered it, which reads as a tooltip rather than a screen-level
 * notification, and it avoids relying on a library that is untested in this
 * app on web.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

export type ToastVariant = 'success' | 'warning' | 'error';

export interface ToastState {
  /** Bumped on every show so repeating the same message re-triggers it. */
  id: number;
  message: string;
  detail?: string;
  variant: ToastVariant;
}

const VARIANT_STYLES: Record<ToastVariant, { icon: string; color: string }> = {
  success: { icon: 'check-circle', color: '#34C759' },
  warning: { icon: 'alert-circle', color: '#FF9500' },
  error: { icon: 'close-circle', color: '#FF3B30' },
};

/** Success is a glance; anything the user must read gets longer. */
const DURATION: Record<ToastVariant, number> = {
  success: 1800,
  warning: 3200,
  error: 3800,
};

export const useToast = () => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback(
    (message: string, detail?: string, variant: ToastVariant = 'success') => {
      nextId.current += 1;
      setToast({ id: nextId.current, message, detail, variant });
    },
    [],
  );

  const hideToast = useCallback(() => setToast(null), []);

  return { toast, showToast, hideToast };
};

interface ToastProps {
  toast: ToastState | null;
  onHide: () => void;
  /** Distance from the top of the containing view. */
  top?: number;
}

export const Toast: React.FC<ToastProps> = ({ toast, onHide, top = 62 }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!toast) return;

    // Cancel any in-flight dismissal so a rapid second tap restarts cleanly
    // rather than inheriting the previous timer.
    if (timerRef.current) clearTimeout(timerRef.current);

    opacity.setValue(0);
    translateY.setValue(-8);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHide();
      });
    }, DURATION[toast.variant]);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `toast.id` rather than `toast`: showing the same message twice must
    // replay the animation.
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;

  const { icon, color } = VARIANT_STYLES[toast.variant];

  return (
    <Animated.View
      // Never intercepts taps — it sits over the content it is describing.
      pointerEvents="none"
      style={[styles.container, { top, opacity, transform: [{ translateY }] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.pill}>
        <Icon name={icon as any} size={18} color={color} />
        <View style={styles.textWrapper}>
          <Text style={styles.message}>{toast.message}</Text>
          {toast.detail ? <Text style={styles.detail}>{toast.detail}</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 20,
    left: 20,
    alignItems: 'flex-end',
    zIndex: 1000,
    elevation: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.colors.border || '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  textWrapper: {
    flexShrink: 1,
  },
  message: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  detail: {
    color: theme.colors.subtext,
    fontSize: 12,
    marginTop: 2,
  },
});

export default Toast;
