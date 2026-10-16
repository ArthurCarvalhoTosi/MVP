module.exports = {
  preset: 'jest-expo',
  // shortcut: expo-modules-core is nested under expo/ (its worklets peer range lags reanimated 4.7); drop when Expo aligns the peer range.
  modulePaths: ['<rootDir>/node_modules/expo/node_modules'],
};
