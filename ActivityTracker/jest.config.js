module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native-community/.*|@react-navigation/.*|@react-native/js-polyfills|expo.*)',
  ],
  // Files staged for deletion (this mount cannot unlink) must not be collected
  // as test suites or matched against snapshots.
  testPathIgnorePatterns: ['/node_modules/', '/_to_delete/', '/ios/', '/android/'],
  modulePathIgnorePatterns: ['/_to_delete/'],
};
