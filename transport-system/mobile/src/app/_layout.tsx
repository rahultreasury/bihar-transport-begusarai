import { Stack } from 'expo-router';
import { SessionProvider } from '@/contexts/SessionContext';
import { BookingFormProvider } from '@/contexts/BookingFormContext';
import React from 'react';
import { View, Text } from 'react-native';

console.log('[RootLayout] Rendering root layout');

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>Error occurred - check console</Text></View>;
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  console.log('[RootLayout] RootLayout component executing');
  return (
    <ErrorBoundary>
      <SessionProvider>
        <BookingFormProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#F8FAFC' },
            }}
          />
        </BookingFormProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}