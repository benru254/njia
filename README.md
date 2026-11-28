# Njia

*Njia* means "path" in Swahili. It is an Android app that records exactly where you went, and shows it back clearly:

- your day cut into **separate trips**: A → B, B → C, C → D
- every **destination**: where, when you arrived, when you left, how long you stayed
- short stops and traffic jams kept **inside** a trip as pauses, not counted as destinations
- **one-tap fixes**: Split a trip in two, or Join two trips into one
- **Google Maps** and **Navigate** buttons on every point
- **names** for places you use often (Shop 2, Home, a customer)
- walking or vehicle for each trip (motorbike, car, matatu)
- **speed**, **direction** and **time** at every point, a speed chart and a replay

It works **with no internet**. Trips are stored on the phone. You choose when to send a trip anywhere.

---

## 1. Install on your phone

1. On the phone, open this repository's **Releases** page (right side of the GitHub page) while signed in to GitHub.
2. Open the newest release and tap the file ending in **`.apk`**.
3. Open the downloaded file. Android will ask to "allow installs from this source" once. Allow it, then tap **Install**.
4. Open **Njia**, tap **Setup**, and complete the 4 steps. Step 4 (battery limits) matters most.

To update later: download the newer `.apk` and install it over the old one. Your trips are kept.

> If Google Play Protect warns about an "unknown developer", that is expected: this is your own private app, not from the Play Store. Choose "Install anyway".

## 2. Record

**Always on (recommended):** Setup › How recording starts › **Always on**. Allow location **"Allow all the time"** when asked.
Njia then records by itself, every day, also after the phone restarts or the battery dies. There is no Start or Stop:
open the app any time to see your trips. Each day is one recording, cut into trips.

**Manual:** tap **Start recording**, then **Stop and save**.

GPS stays on at full accuracy the whole time it records, moving or not. Accurate data comes before battery life.
(Version 1.0.3 switched GPS off when you were still; on the road that caused straight-line jumps and impossible
speeds, so it was removed in 1.0.4.)

How it keeps your data: every GPS point is written to storage the moment it arrives, so a dead battery loses at most
the point being written. The recorder runs on its own (it does not need the app open) and is restarted after a phone
restart, after an app update, and by a 15-minute watchdog if a battery manager stopped it.

**Hiding the notification:** Android 13 and newer: Setup › Hide the notification › turn off notifications for Njia.
Recording continues. On Android 12 and older it cannot be hidden fully; it is set to the quietest level.

## 3. How a day is cut into trips

A stop becomes a **destination** (one trip ends there and the next begins) when:

| You stayed | Counts when |
|---|---|
| 5 minutes or more | always (change to 3, 7 or 10 minutes in Setup) |
| 3 minutes or more | you walked away from the vehicle and came back to it (a drop-off) |
| 2 minutes or more | at a place you named |

Anything shorter stays **inside** the trip: a **pause** (traffic light, quick stop) or **traffic** (crawling in a jam).
A completely still jam of 5+ minutes can look like a destination: tap **Not a destination** to fix it.

## 4. Look at trips

- The home screen lists trips by day: time, from → to, distance, duration, vehicle.
- Tap a trip to see it alone on the map. **‹ ›** go to the previous / next trip; **All** shows the whole day.
- **Trip** tab: from and to, distance, moving / paused / traffic time, speeds, how you travelled, and the fix buttons.
- **Stops** tab: every destination and pause, with **Google Maps**, **Navigate** and **Name this place**.
- **Trips** tab: the list of trips in this recording.
- **Tap the path** or **drag on the chart** to see time, speed and direction at that spot. **Play** replays it.
- Grey dashed line = **no data** (the phone lost signal or Android paused the app).

**Fixing a wrong cut (one tap):**
- Two trips that are really one: **Join with next trip** (or **Not a destination** on the stop).
- A pause that was really a destination: **Make it a destination**.
- One trip that should be two: drag the chart to the moment, then **Split this trip at …**.

## 5. See it on Google Maps / Google Earth

Google does not let other apps add to its Timeline, so these are the two ways:

- **Google Earth (phone):** open a recording, tap **Google Earth**, choose Google Earth. Every trip is a coloured line,
  every stop a named pin.
- **Google Maps (phone, after a one-time import on a PC):** tap **Google Earth**, save the file to Google Drive. On a PC
  open mymaps.google.com › Create a new map › Import › pick the file. The map now appears in the Google Maps app under
  **You › Maps** (or Saved › Maps).
- **One trip in Google Maps:** in a trip's **Trip** tab tap **Open this trip in Google Maps**. Google draws its own road
  route through 8 points of your real path: close to where you went, not exact.
- **Single points:** **Google Maps** and **Navigate** on every stop.

## 6. View on your PC

1. From any release, download **`njia-viewer.html`** to your PC (once).
2. On the phone, open a trip and tap **Send to PC**. Send the file to yourself (WhatsApp, email, Google Drive, Bluetooth or USB cable).
3. On the PC, double-click `njia-viewer.html` and drop the trip file onto it.

The viewer also opens `.gpx` files from other GPS apps. Nothing is uploaded: the file stays on your computer.

**Share GPX** makes a standard file for other map apps. Open it in **Organic Maps** to see the path on a fully offline street map.

## 7. What to expect (honest limits)

| | |
|---|---|
| Accuracy | About 3–5 m under open sky. 10–30 m between tall buildings, inside vehicles or indoors. |
| Battery | GPS is on all the time while recording. On Always on it is one of the biggest battery users on the phone: keep a charger at home and the office. |
| Old 1.0.3 days | Recordings made with 1.0.3 keep their straight-line jumps (the data was never recorded). They now show as "No data" with a jump distance, and no longer give fake speeds. |
| Phone switched off | Nothing can record while the phone is off. After it restarts, Njia continues by itself once the phone is unlocked the first time. |
| Street map background | Needs internet the first time you view an area. The path, speeds and stops never need internet. |
| Phones that kill apps | Tecno, Infinix, itel, Xiaomi, Oppo, Vivo and Huawei need the extra steps shown in Setup. |
| Privacy | Trips never leave the phone unless you tap a Share button. |
| Jams vs destinations | A jam where you do not move at all for 5+ minutes looks the same as a stop to GPS. Fix it with one tap. |
| Car vs motorbike | A phone cannot tell them apart. Set your usual vehicle in Setup; change single trips by hand. |

---

## What is built, what is next

**Done**
- Part 1: offline recording in the background, map view, speed colours, arrows, replay, speed chart, GPX, PC viewer, automatic APK build
- Part 2: a day cut into separate trips, destinations vs pauses vs traffic, one-tap Split / Join, named places, Google Maps and Navigate buttons, walking / vehicle per trip

- Part 3: Always on (no Start / Stop), restart after phone restart, data saved on every point, hideable notification, Google Earth / My Maps export, trips in Google Maps
- 1.0.4: GPS-off battery saving removed (accuracy first); jumps over missing data no longer count as speed

**Not built yet (ideas)**
- Automatic upload when the phone is on Wi-Fi, to your PC and to a cloud database
- All days together on one map on the PC (history, heatmap, weekly totals)

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
src/core/              pure logic: filtering, stops, cutting a day into trips (segment.ts), GPX. No phone code. Tested.
src/data/              the on-phone database and file export
modules/njia-tracker/  the native recorder (Kotlin): runs without the app, full-accuracy GPS, restart after reboot
src/data/importer.ts   moves points from the recorder into recordings (one per day in Always on)
src/tracking/          switching recording on/off, Android permissions
src/screens/           Home, Trip, Setup
src/components/        small reusable pieces
viewer/                the map page (runs inside the app AND on a PC)
tests/                 unit tests and the fake-trip generator
scripts/               viewer build script, icon generator
.github/workflows/     builds the APK on every push to main
```

The app cannot run in **Expo Go**, because background GPS needs native code. Test with the APK from Releases.
