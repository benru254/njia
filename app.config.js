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
          // Manual recording needs only "While using the app" (it runs as a foreground
          // service with a notification). Always on also needs "Allow all the time",
          // so the recorder may start again by itself after a phone restart.
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          locationWhenInUsePermission: 'Njia records your position to draw the path of your trips.',
          locationAlwaysAndWhenInUsePermission: 'Njia records your trips by itself, even after the phone restarts.',
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
