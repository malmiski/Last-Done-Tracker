module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native-community/.*|@react-navigation/.*|@react-native/js-polyfills|expo.*)',
  ],
};