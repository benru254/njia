# Njia

*Njia* means "path" in Swahili. It is an Android app that records exactly where you went, and shows it back clearly:

- the full path on a map, with **Start** and **End** marked
- **speed** at every point (the path is coloured by speed)
- **direction** of travel (arrows on the path, compass reading)
- **time** at every point (tap the path or drag the chart)
- every **stop**: where, when you arrived, when you left, how long you stayed
- totals: distance, moving time, stopped time, average and top speed
- a **replay** that moves along the path

It works **with no internet**. Trips are stored on the phone. You choose when to send a trip anywhere.

---

## 1. Install on your phone

1. On the phone, open this repository's **Releases** page (right side of the GitHub page) while signed in to GitHub.
2. Open the newest release and tap the file ending in **`.apk`**.
3. Open the downloaded file. Android will ask to "allow installs from this source" once. Allow it, then tap **Install**.
4. Open **Njia**, tap **Setup**, and complete the 4 steps. Step 4 (battery limits) matters most.

To update later: download the newer `.apk` and install it over the old one. Your trips are kept.

> If Google Play Protect warns about an "unknown developer", that is expected: this is your own private app, not from the Play Store. Choose "Install anyway".

## 2. Record a trip

1. Tap **Start recording**. A permanent notification "Njia is recording your trip" appears. That notification is what keeps recording alive with the screen off.
2. Go about your day. You can lock the phone or use other apps.
3. Tap **Stop and save**. The trip opens on the map.

## 3. Look at a trip

- **Tap the path** or **drag on the chart** to see time, speed and direction at that spot.
- **Play** replays the trip. The buttons beside it jump to the previous / next stop.
- **Details › Stops** lists every stop with arrival, departure and duration.
- **Details › Summary** has the totals, and lets you choose how long counts as a stop (1 to 20 minutes).
- Grey dashed line = **no data** (the phone lost signal or Android paused the app).

## 4. View on your PC

1. From any release, download **`njia-viewer.html`** to your PC (once).
2. On the phone, open a trip and tap **Send to PC**. Send the file to yourself (WhatsApp, email, Google Drive, Bluetooth or USB cable).
3. On the PC, double-click `njia-viewer.html` and drop the trip file onto it.

The viewer also opens `.gpx` files from other GPS apps. Nothing is uploaded: the file stays on your computer.

**Share GPX** makes a standard file for other map apps. Open it in **Organic Maps** to see the path on a fully offline street map.

## 5. What to expect (honest limits)

| | |
|---|---|
| Accuracy | About 3–5 m under open sky. 10–30 m between tall buildings, inside vehicles or indoors. |
| Battery | Recording every 3 seconds all day uses noticeable battery. Change the interval in Setup. |
| Street map background | Needs internet the first time you view an area. The path, speeds and stops never need internet. |
| Phones that kill apps | Tecno, Infinix, itel, Xiaomi, Oppo, Vivo and Huawei need the extra steps shown in Setup. |
| Privacy | Trips never leave the phone unless you tap a Share button. |

---

## What is built, what is next

**Done (Part 1)**
- Offline recording in the background, saved to the phone's database
- Trip list, map view, speed colours, arrows, stops, gaps, replay, speed chart
- Share as GPX, send to PC, PC viewer
- Automatic APK build on GitHub

**Next (Part 2, not built yet)**
- Automatic upload when the phone is on Wi-Fi, to your PC and to a cloud database
- All trips together on one map on the PC (history, heatmap, daily totals)
- Naming trips and saving named places ("Shop 2", "Home")

---

## For developers (and GitHub Copilot)

See [AGENTS.md](AGENTS.md) for the project rules. Quick reference:

```
npm install            # installs packages and builds the map viewer
npm run check          # builds the viewer, checks types, runs the tests
npm run build:viewer   # rebuild the viewer after editing anything in viewer/
```

Folder map:

```
App.tsx, index.ts      app entry (index.ts registers the background GPS job first)
src/core/              pure logic: distance, filtering, stop detection, GPX. No phone code. Tested.
src/data/              the on-phone database and file export
src/tracking/          background recording and Android permissions
src/screens/           Home, Trip, Setup
src/components/        small reusable pieces
viewer/                the map page (runs inside the app AND on a PC)
tests/                 unit tests and the fake-trip generator
scripts/               viewer build script, icon generator
.github/workflows/     builds the APK on every push to main
```

The app cannot run in **Expo Go**, because background GPS needs native code. Test with the APK from Releases.
