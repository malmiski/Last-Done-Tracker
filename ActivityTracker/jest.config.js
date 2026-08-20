module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    // `@react-native/.*` rather than just `@react-native/js-polyfills`: any
    // component that actually renders a FlatList pulls in
    // @react-native/virtualized-lists, which ships untranspiled ES modules.
    'node_modules/(?!(jest-)?react-native|@react-native/.*|@react-native-community/.*|@react-navigation/.*|expo.*)',
  ],
  // Files staged for deletion (this mount cannot unlink) must not be collected
  // as test suites or matched against snapshots.
  testPathIgnorePatterns: ['/node_modules/', '/_to_delete/', '/ios/', '/android/'],
  modulePathIgnorePatterns: ['/_to_delete/'],
};
