// Entry point for Expo Router v3
// This file ensures Metro uses the correct entry point instead of eslint.config.js

export { registerRootComponent } from 'expo';
import * as React from 'react';
import { View, Text } from 'react-native';

// Minimal root component - Expo Router will replace this with the actual router
export default function App() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Loading...</Text>
    </View>
  );
}