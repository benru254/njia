/** Everything Android needs to allow before recording is reliable. */
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

export const ANDROID_PACKAGE = 'com.benru254.njia';

export interface SetupStatus {
  /** Location permission allowed. */
  location: boolean;
  /** Allowed as "Precise" (not "Approximate"). */
  precise: boolean;
  /** The phone's Location/GPS switch is on. */
  gpsOn: boolean;
  /** Notifications allowed (so the "recording" notice is visible). */
  notifications: boolean;
  /** Android will NOT put this app to sleep to save battery. */
  batteryFree: boolean;
  /** Location "Allow all the time" (needed for Always on). */
  background: boolean;
}

const needsNotificationPermission = Platform.OS === 'android' && Number(Platform.Version) >= 33;

export async function getSetupStatus(): Promise<SetupStatus> {
  const [perm, bg, gpsOn, notifications, optimised] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    Location.hasServicesEnabledAsync().catch(() => false),
    needsNotificationPermission
      ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => false)
      : Promise.resolve(true),
    Platform.OS === 'android'
      ? Battery.isBatteryOptimizationEnabledAsync().catch(() => true)
      : Promise.resolve(false),
  ]);
  return {
    location: !!perm?.granted,
    precise: !!perm?.granted && perm.android?.accuracy !== 'coarse',
    gpsOn,
    notifications,
    batteryFree: !optimised,
    background: !!bg?.granted,
  };
}

/** Everything needed for reliable recording. Always on also needs "Allow all the time". */
export const isReady = (s: SetupStatus, always = false) =>
  s.location && s.precise && s.gpsOn && s.batteryFree && (!always || s.background);

/**
 * Ask for location "Allow all the time". Android shows its settings page for this;
 * the user must pick "Allow all the time" there.
 */
export async function requestBackgroundLocation(): Promise<void> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) {
    await requestLocation();
    if (!(await Location.getForegroundPermissionsAsync()).granted) return;
  }
  const res = await Location.requestBackgroundPermissionsAsync();
  if (!res.granted && !res.canAskAgain) await Linking.openSettings();
}

/** Open Njia's notification settings, where the recording notice can be switched off. */
export async function openNotificationSettings(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
      extra: { 'android.provider.extra.APP_PACKAGE': ANDROID_PACKAGE },
    });
  } catch {
    await Linking.openSettings();
  }
}

/** Android 13 and newer can hide the recording notice completely. */
export const canHideNotification = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** Ask for location. If Android will not ask again, open the app's settings page instead. */
export async function requestLocation(): Promise<void> {
  const res = await Location.requestForegroundPermissionsAsync();
  if (!res.granted && !res.canAskAgain) await Linking.openSettings();
}

export async function requestNotifications(): Promise<void> {
  if (!needsNotificationPermission) return;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  if (res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await Linking.openSettings();
}

/** Ask Android to switch the GPS on (shows the system pop-up). */
export async function requestGpsOn(): Promise<void> {
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }
}

/** Open the "let this app run without battery limits" screen. */
export async function requestBatteryFree(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: 'package:' + ANDROID_PACKAGE,
    });
  } catch {
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }
}
