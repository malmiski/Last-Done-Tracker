import React, { useRef } from 'react';
import { View, StyleSheet, TextInput, Pressable } from 'react-native';
import theme from '../theme/theme';

interface PinInputBoxProps {
  pinLength: number;
  pin: string;
  onPinChange: (pin: string) => void;
}

const PinInputBox: React.FC<PinInputBoxProps> = ({ pinLength, pin, onPinChange }) => {
  const inputRef = useRef<TextInput>(null);

  const dots = [];
  for (let i = 0; i < pinLength; i++) {
    dots.push(
      <View
        key={i}
        style={[
          styles.dot,
          i < pin.length ? styles.dotFilled : styles.dotEmpty,
        ]}
      />
    );
  }

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={pin}
        onChangeText={onPinChange}
        maxLength={pinLength}
        keyboardType="numeric"
        secureTextEntry
      />
      {dots}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 30,
    paddingVertical: 20,
  },
  input: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotEmpty: {
    backgroundColor: theme.colors.PINdot,
  },
  dotFilled: {
    backgroundColor: theme.colors.text,
  },
});

export default PinInputBox;
