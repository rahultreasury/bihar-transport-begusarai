import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

console.log('[HomeScreen] Minimal HomeScreen component executing');

export default function HomeScreen() {
  console.log('[HomeScreen] Minimal HomeScreen render');
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bihar Transport - Home Screen Works!</Text>
      <Text style={styles.subtitle}>If you see this, the app is rendering correctly.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E40AF',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    textAlign: 'center',
  },
});