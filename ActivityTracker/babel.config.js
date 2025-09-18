module.exports = function (api) {
  api.cache(true);
  return {
    dependencies: {
      'react-native-vector-icons': {
        platforms: {
          ios: null,
        },
      },
    },
    presets: ['babel-preset-expo'],
  };
};  