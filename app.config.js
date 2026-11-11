/**
 * App settings (name, icon, Android permissions).
 * The build number comes from GitHub Actions, so every new APK installs over the old one.
 */
const buildNumber = Number(process.env.BUILD_NUMBER || 1);

module.exports = {
  expo: {
    name: 'Njia',
    slug: 'njia',
    version: `1.0.${buildNumber}`,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: '#10151c',
    android: {
      package: 'com.benru254.njia',
      versionCode: buildNumber,
      adaptiveIcon: {
        backgroundColor: '#10151c',
        foregroundImage: './assets/android-icon-foreground.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'],
    },
    plugins: [
      [
        'expo-location',
        {
          // Recording runs as a visible "foreground service" (the notification),
          // so the app only needs "While using the app" location permission.
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: true,
          locationWhenInUsePermission: 'Njia records your position to draw the path of your trip.',
        },
      ],
      'expo-sqlite',
      'expo-task-manager',
      'expo-sharing',
      [
        'expo-splash-screen',
        { image: './assets/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#10151c' },
      ],
    ],
  },
};
