module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native-community/.*|@react-navigation/.*|@react-native/js-polyfills|expo-router|expo-linking|expo-constants|expo-status-bar)',
  ],
};
