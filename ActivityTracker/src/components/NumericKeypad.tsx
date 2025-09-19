import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import theme from '../theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';

interface NumericKeypadProps {
  onPress: (value: string) => void;
  onBackspace: () => void;
}

const NumericKeypad: React.FC<NumericKeypadProps> = ({ onPress, onBackspace }) => {
  const buttons = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    '', '0', 'backspace'
  ];

  return (
    <View style={styles.container}>
      {buttons.map((value) => {
        if (value === '') {
          return <View key={value} style={styles.button} />;
        }
        if (value === 'backspace') {
          return (
            <TouchableOpacity key={value} style={styles.button} onPress={onBackspace}>
              <Icon name="backspace-outline" size={30} color={theme.colors.text} />
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity key={value} style={styles.button} onPress={() => onPress(value)}>
            <Text style={styles.buttonText}>{value}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  button: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    margin: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  buttonText: {
    color: theme.colors.text,
    fontSize: 30,
  },
});

export default NumericKeypad;
