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
| **An APK, built and published for you** | push to `main`, or tag `v*` | Nothing — GitHub Actions builds it |
| An APK to sideload / share on WhatsApp | `npm run build:apk` | Free Expo account |
| An APK built on your own machine, no account | `npm run apk:gradle` | Android SDK + JDK 17 |
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

## Path A — GitHub builds it (recommended)

Nothing to install, no Expo account, no Android SDK. The **Android APK** job in
`.github/workflows/build-windows.yml` builds it on every push to `main` and on
every `v*` tag, alongside the Windows installer and the web app.

- **Push to `main`** → the APK appears under **Actions → the run → Artifacts →
  `nickland-edusoft-android`** (kept 30 days).
- **Tag `v2.0.1` and push the tag** → the APK is attached to the GitHub release
  permanently, next to the `.exe` and the web app zip. That is the link to send
  a school.

The build takes roughly 15 minutes.

### Set the signing key first — once, before you hand the APK to anyone

Without a key configured the job signs with the React Native template's debug
key, whose private key is published on the internet. The APK works, and the
filename says `-testing-key` so you cannot hand it out by accident, but anyone
could sign a malicious "update" for it.

Generate a real one and keep it forever:

```bash
keytool -genkeypair -v -keystore release.keystore -alias edusoft \
        -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore        # macOS: base64 -i release.keystore
```

Then add four repository secrets (**Settings → Secrets and variables → Actions
→ Secrets**):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 output above |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
| `ANDROID_KEY_ALIAS` | `edusoft` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

> **Keep `release.keystore` with the school's irreplaceable files.** Lose it and
> no future update can install over the copies already on people's phones —
> every one has to be uninstalled first, and everybody signs in again.

### Set the portal address

Add a repository **variable** (same page, Variables tab) named
`EXPO_PUBLIC_PORTAL_URL`, pointing at the hosted API — e.g.
`https://nickland-edusoft-cloud.onrender.com`. It is compiled into the app and
is the address it falls back to when it is not on the school Wi-Fi. Without it,
a parent has to type the portal address by hand on the Connect screen.

---

## Path B — Cloud build with EAS

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

## Path C — Local build (no Expo account)

Everything happens on your machine. Useful if the school has poor internet or
you would rather not depend on a cloud service.

**Needs:** JDK 17, and an Android SDK with these components — `expo-modules-core`
compiles native code, so the NDK and CMake are not optional:

| Component | Version |
|---|---|
| Platform | `android-34` |
| Build tools | `34.0.0` |
| NDK | `26.1.10909125` (pinned by React Native 0.74) |
| CMake | `3.22.1` |

Android Studio installs all of them; from the command line:

```bash
sdkmanager "platforms;android-34" "build-tools;34.0.0" \
           "ndk;26.1.10909125" "cmake;3.22.1"
```

With `ANDROID_HOME` set:

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

By default Gradle signs a release build with the template's debug key — fine
for trying it, not for one a school runs. Sign it properly with the same
keystore you use in CI:

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner sign \
  --ks release.keystore --ks-key-alias edusoft \
  android/app/build/outputs/apk/release/app-release.apk
```

**Use the same keystore for every future release**, or updates will not install
over the copies already out there.

> `apk:gradle` runs `expo prebuild --clean` first, which matters for more than
> the icon: it wipes `android/`, so the JS bundling step cannot be skipped as
> up to date. Gradle does not treat an environment variable as an input, so a
> changed `EXPO_PUBLIC_PORTAL_URL` would otherwise rebuild happily and ship the
> old address.

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

## Size and permissions

The APK is about **33 MB**. It would be 62 MB by default: Expo packages native
libraries for all four Android ABIs, and two of them — `x86` and `x86_64` — are
emulators and a handful of Chromebooks, not phones. `plugins/with-abi-filters.js`
drops them. That is a config plugin rather than an edit to `app/build.gradle`
because `prebuild` regenerates that file; plugins are re-applied every time.

The permissions it asks for are only these:

| Permission | Why |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | reaching the school or the portal |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `expo-secure-store` keeping the session in the keychain |
| `VIBRATE` | React Native |

`SYSTEM_ALERT_WINDOW` ("display over other apps") is blocked in `app.json`.
React Native asks for it to draw its developer overlay, which a release build
never shows — and a school management app requesting permission to draw over
other apps is exactly the kind of thing that gets an APK distrusted.

## What is generated vs what is source

`mobile/android/` and `mobile/ios/` are **generated from `app.json`** and are
git-ignored. Never hand-edit them — the next `prebuild` throws the changes away.
Icon, splash, package name, permissions and version all live in `app.json`,
`plugins/` holds config plugins that adjust the generated Gradle files, and
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
| `[CXX1210] No compatible library found` | The NDK or CMake is missing, or a different NDK than the pinned `26.1.10909125`. Install the components listed under Path C. (It also appears when anything writes to the prefab helper's stderr — `JAVA_TOOL_OPTIONS` being set is enough.) |
| The app points at the wrong portal address | `EXPO_PUBLIC_PORTAL_URL` is compiled in, and Gradle does not treat an environment variable as an input. Run `expo prebuild --clean` first, which is what `apk:gradle` and CI both do. |
| App opens to a blank screen | Almost always a JS error. `npm run bundle:check` first, then `npx expo start` and read the terminal. |
| Icon looks cropped on Android | Art in `adaptive-icon.png` is outside the safe middle 66%. |
