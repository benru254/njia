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

1. Tap **Start recording**. A permanent notification "Njia is recording your trip" appears. That notification is what keeps recording alive with the screen off.
2. Go about your day. You can lock the phone or use other apps. One recording can last the whole day.
3. Tap **Stop and save**. The recording opens with all its trips.

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

## 5. View on your PC

1. From any release, download **`njia-viewer.html`** to your PC (once).
2. On the phone, open a trip and tap **Send to PC**. Send the file to yourself (WhatsApp, email, Google Drive, Bluetooth or USB cable).
3. On the PC, double-click `njia-viewer.html` and drop the trip file onto it.

The viewer also opens `.gpx` files from other GPS apps. Nothing is uploaded: the file stays on your computer.

**Share GPX** makes a standard file for other map apps. Open it in **Organic Maps** to see the path on a fully offline street map.

## 6. What to expect (honest limits)

| | |
|---|---|
| Accuracy | About 3–5 m under open sky. 10–30 m between tall buildings, inside vehicles or indoors. |
| Battery | Recording every 3 seconds all day uses noticeable battery. Change the interval in Setup. |
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
src/tracking/          background recording and Android permissions
src/screens/           Home, Trip, Setup
src/components/        small reusable pieces
viewer/                the map page (runs inside the app AND on a PC)
tests/                 unit tests and the fake-trip generator
scripts/               viewer build script, icon generator
.github/workflows/     builds the APK on every push to main
```

The app cannot run in **Expo Go**, because background GPS needs native code. Test with the APK from Releases.
