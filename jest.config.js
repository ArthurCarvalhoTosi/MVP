module.exports = {
  preset: 'jest-expo',
  // reanimated 4 + worklets need their own resolver under jest.
  resolver: 'react-native-reanimated/jest/resolver',
  // shortcut: expo-modules-core is nested under expo/ (its worklets peer range lags reanimated 4.7); drop when Expo aligns the peer range.
  modulePaths: ['<rootDir>/node_modules/expo/node_modules'],
};
