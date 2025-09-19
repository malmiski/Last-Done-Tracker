import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

const icons = [
  'run', 'weight-lifter', 'swim', 'bike', 'flower',
  'leaf', 'book-open-variant', 'coffee',
];

interface IconGridProps {
  selectedIcon: string;
  onSelectIcon: (icon: string) => void;
}

const IconGrid: React.FC<IconGridProps> = ({ selectedIcon, onSelectIcon }) => {
  return (
    <View style={styles.grid}>
      {icons.map(icon => (
        <TouchableOpacity
          key={icon}
          style={[
            styles.iconContainer,
            selectedIcon === icon && styles.iconContainerSelected,
          ]}
          onPress={() => onSelectIcon(icon)}
        >
          <Icon
            name={icon}
            size={30}
            color={selectedIcon === icon ? theme.colors.background : theme.colors.text}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    margin: 10,
  },
  iconContainerSelected: {
    backgroundColor: theme.colors.primary,
  },
});

export default IconGrid;
