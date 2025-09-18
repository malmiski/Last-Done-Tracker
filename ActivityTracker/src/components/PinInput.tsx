import React from 'react';
import { View, StyleSheet } from 'react-native';
import theme from '../theme/theme';

interface PinInputProps {
  pinLength?: number;
  filledDots: number;
}

const PinInput: React.FC<PinInputProps> = ({ pinLength = 6, filledDots }) => {
  const dots = [];
  for (let i = 0; i < pinLength; i++) {
    dots.push(
      <View
        key={i}
        style={[
          styles.dot,
          i < filledDots ? styles.dotFilled : styles.dotEmpty,
        ]}
      />
    );
  }

  return <View style={styles.container}>{dots}</View>;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginHorizontal: 10,
  },
  dotEmpty: {
    backgroundColor: theme.colors.PINdot,
  },
  dotFilled: {
    backgroundColor: theme.colors.PINdotActive,
  },
});

export default PinInput;
