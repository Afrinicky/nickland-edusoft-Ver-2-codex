# Building the installable mobile app

The mobile app is React Native (Expo SDK 51). This page is how you turn the
source in `mobile/` into an **APK you can put on a teacher's or parent's phone**.

For what the app *does*, see [`../mobile/README.md`](../mobile/README.md); for
the API it talks to, [`MOBILE_API.md`](MOBILE_API.md).

---

## Which build do I want?

| You want | Use | Needs |
|---|---|---|
| **No install at all — just an address** | `npm run build:web` (repo root) | Nothing; see [`WEB_APP.md`](WEB_APP.md) |
| An APK to sideload / share on WhatsApp | `npm run build:apk` | Free Expo account |
| An APK built on your own machine, no account | `npm run apk:gradle` | Android SDK + JDK 17+ |
| To put it on Google Play | `npm run build:play` | Play Console account ($25 once) |
| To test while developing | `npm start` | Expo Go on the phone |

For a single school in Ghana, **sideloading the APK is the right answer** —
no Play Store account, no review delay, and it installs from a memory stick,
Bluetooth or WhatsApp.

Faster still, and worth doing first: the **web build**. Same screens, no
install — the desktop serves it over the school Wi-Fi and the portal serves it
over the internet, and on HTTPS a parent can add it to their home screen where
it behaves like an installed app. See [`WEB_APP.md`](WEB_APP.md). The APK is
the better experience on a phone; it is not a prerequisite for getting people
using the system.

---

## Path A — Cloud build (recommended)

Expo builds it on their servers; you download an APK. Nothing to install on your
computer beyond Node.

```bash
cd mobile
npm install

npm install -g eas-cli          # once
eas login                       # free account at expo.dev
eas init                        # links this folder to a project — once

npm run build:apk               # ~10-20 minutes
```

EAS prints a download link when it finishes, and the build also appears at
[expo.dev](https://expo.dev) under your account. Download the `.apk` and share
it however you like.

> The **first** Android build asks whether to generate a keystore. Say **yes**
> and let EAS keep it. That keystore is the app's identity — if you lose it, a
> future update cannot install over the old one and every phone has to
> uninstall first. `eas credentials` downloads a backup; keep it with the
> school's other important files.

### Build profiles (`mobile/eas.json`)

| Profile | Output | For |
|---|---|---|
| `apk` | `.apk` | Sideloading — this is the one you usually want |
| `preview` | `.apk` | Same, on the `preview` release channel for testing |
| `production` | `.aab` | Google Play (Play requires an App Bundle, not an APK) |
| `development` | `.apk` | Dev client with the debug menu |

---

## Path B — Local build (no Expo account)

Everything happens on your machine. Useful if the school has poor internet or
you would rather not depend on a cloud service.

**Needs:** JDK 17+, the Android SDK (Android Studio installs both), and
`ANDROID_HOME` set.

```bash
cd mobile
npm install
npm run apk:gradle
```

That regenerates the native project from `app.json` and runs Gradle. The APK
lands at:

```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

By default Gradle signs a release build with the local debug key. To sign with a
real key, put a keystore in `mobile/android/app/` and set
`MYAPP_RELEASE_STORE_FILE`, `MYAPP_RELEASE_KEY_ALIAS`,
`MYAPP_RELEASE_STORE_PASSWORD` and `MYAPP_RELEASE_KEY_PASSWORD` in
`mobile/android/gradle.properties`. **Use the same keystore for every future
release.**

---

## Installing it on a phone

1. Copy the `.apk` to the phone (USB, WhatsApp, Bluetooth, memory stick).
2. Tap it. Android will say *"For your security, your phone can't install
   unknown apps from this source"* — tap **Settings**, allow it for the app
   doing the installing (Files, Chrome, WhatsApp), then go back and tap Install.
3. Open the app and connect (below).

That "unknown sources" prompt is normal for any app not from the Play Store, and
appears once per source.

---

## Connecting the app to the school

On the desktop: **Settings → Mobile App → Start server.** It shows the address,
for example `http://192.168.1.20:4747`.

In the app:

- **School Wi-Fi** — type that address. Teachers use this: full features,
  including marking attendance, entering scores and collecting canteen money.
- **Over the internet** — type the school's portal address, pick the school.
  Parents use this from anywhere: fees, results, attendance, receipts, notices.

The phone must be on the **same Wi-Fi as the desktop** for the LAN option, and
the desktop's IP changes if the router reassigns it — give the desktop a fixed
IP on the router if teachers have to retype it often.

> LAN traffic is plain HTTP, which is why `usesCleartextTraffic` is on. That is
> fine inside a school's own Wi-Fi. Anything reaching the app over the internet
> should go through the cloud portal on HTTPS.

---

## Releasing an update

Bump both numbers in `mobile/app.json` before every build you hand out:

```jsonc
"version": "1.1.0",          // what people see
"android": { "versionCode": 2 }   // must increase every single time
```

Android refuses to install an APK whose `versionCode` is not higher than the one
already on the phone, so forgetting this is the usual reason an update "won't
install". The `production` profile auto-increments; the `apk` profile does not,
deliberately — a sideloaded build should be a number you chose.

---

## Checking it builds without building it

Two fast checks, both used while developing this app:

```bash
npm run bundle:check    # bundles every screen through Metro — catches syntax
                        # and import errors across the whole app in ~20s
npm run prebuild        # regenerates android/ from app.json — proves the icon,
                        # splash, permissions and version all resolve
```

`bundle:check` is the meaningful one: it compiles all 18 screens and their 3 layouts. If it passes,
the JavaScript is sound; what it cannot tell you is whether a native module
behaves on a real device.

---

## What is generated vs what is source

`mobile/android/` and `mobile/ios/` are **generated from `app.json`** and are
git-ignored. Never hand-edit them — the next `prebuild` throws the changes away.
Icon, splash, package name, permissions and version all live in `app.json`, and
`assets/` holds the images:

| File | Used for |
|---|---|
| `assets/icon.png` | App icon (iOS, and the fallback on Android) |
| `assets/adaptive-icon.png` | Android adaptive icon foreground (art stays inside the middle 66% so the launcher's mask cannot crop it) |
| `assets/splash.png` | Launch screen |
| `assets/notification-icon.png` | Monochrome tray icon |
| `assets/favicon.png` | Web build |
| `public/app-icon.png`, `public/app-icon-maskable.png` | Home-screen icon for the web build (copies of the two above) |

To rebrand for another school, replace those images and change `name`, `slug`,
`android.package` and `ios.bundleIdentifier` in `app.json` — and the `name`,
`short_name` and colours in `mobile/public/manifest.json` for the web build.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "App not installed" | `versionCode` not raised, or a different signing key than the installed copy. Uninstall the old one, or fix the key. |
| "Cannot reach the school" | Phone is on mobile data, not the school Wi-Fi; or the desktop's mobile server is not running; or the IP changed. |
| Build fails at "Resolving dependencies" | Usually a `package.json` version outside Expo SDK 51's range. `npx expo-doctor` names the offending package. |
| App opens to a blank screen | Almost always a JS error. `npm run bundle:check` first, then `npx expo start` and read the terminal. |
| Icon looks cropped on Android | Art in `adaptive-icon.png` is outside the safe middle 66%. |
