import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { TripScreen } from './src/screens/TripScreen';
import { C } from './src/theme';

type Route = { name: 'home' } | { name: 'trip'; id: number } | { name: 'setup' };

/**
 * The app has only three screens, so navigation is kept deliberately simple:
 * one "which screen is showing" value, and the phone's Back button returns home.
 */
export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'home') return false; // let Android close/minimise the app
      setRoute({ name: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [route]);

  const goHome = () => setRoute({ name: 'home' });

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />
        {route.name === 'home' ? (
          <HomeScreen onOpenTrip={(id) => setRoute({ name: 'trip', id })} onOpenSetup={() => setRoute({ name: 'setup' })} />
        ) : route.name === 'trip' ? (
          <TripScreen tripId={route.id} onBack={goHome} />
        ) : (
          <SetupScreen onBack={goHome} />
        )}
      </View>
    </SafeAreaProvider>
  );
}
