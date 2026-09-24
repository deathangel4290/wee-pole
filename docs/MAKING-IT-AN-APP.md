# Making BOARD//BOX an app

BOARD//BOX is a **Progressive Web App (PWA)**: a website that can be installed on a phone and behaves like an app. It gets a home-screen icon, opens full screen with no browser bar, and works offline. There are three levels. Do them in order, because each builds on the one before.

| Level | What you get | Cost | Needs |
|---|---|---|---|
| 1. Web app | Link anyone can open and install to their home screen | Free | A public GitHub repo |
| 2. Google Play | A real Play Store listing | $25 once | Level 1, a Google Play developer account |
| 3. Apple App Store | A real App Store listing | $99 / year | Level 1, a Mac with Xcode, an Apple Developer account |

---

## Level 1: Put it online (free, about 5 minutes)

The repo already has everything: app icons, a manifest, an offline service worker, and a GitHub Actions workflow (`.github/workflows/deploy.yml`). The workflow runs the tests and publishes the site every time you push to the default branch.

1. **Make the repo public.** GitHub Pages is free for public repos. While the repo is private, the workflow still runs the tests but skips the deploy.
   *GitHub → repo → Settings → General → Danger Zone → Change visibility → Public.*
2. **Turn on Pages with GitHub Actions as the source.**
   *Settings → Pages → Build and deployment → Source: **GitHub Actions**.*
3. **Run the deploy.** Push any commit to the default branch, or open the *Actions* tab, choose **Test & deploy**, and click **Run workflow**.
4. **Open your site** after a minute or so:
   `https://<your-github-username>.github.io/<repo-name>/`
   For this repo that's **https://deathangel4290.github.io/wee-pole/**.

### Install it on your phone

- **Android (Chrome):** open the link. Tap the **📲 Install BOARD//BOX** card at the bottom of the home screen, or use Chrome's menu → *Install app*.
- **iPhone (Safari):** open the link, tap the **Share** button, then **Add to Home Screen**. It has to be Safari, because other iPhone browsers can't install web apps.

The app now opens full screen from its own icon and works with no internet connection.

### Updating it

Push to the default branch. The workflow redeploys, and phones pick up the new version the next time the app is opened: the service worker loads the cached version instantly and fetches updates in the background. **When you add or rename a file**, add it to `FILES` in `sw.js` and bump `VERSION`, or it won't be available offline.

---

## Level 2: Google Play Store ($25 once)

Google lets you publish a PWA directly as a **Trusted Web Activity**, a thin Android wrapper around your site. The site keeps updating itself, so you only rebuild the Android package for version bumps.

1. Create a developer account at https://play.google.com/console ($25 one-time).
2. Go to **https://www.pwabuilder.com**, enter your site's URL and click **Package for stores → Android**. Download the package.
   - It contains an `.aab` file (what you upload to Play) and a **signing key**. **Back up the key.** You can't publish updates without it.
3. **Prove you own the site.** The package includes an `assetlinks.json` file. It must be served at `https://<your-domain>/.well-known/assetlinks.json`, at the *root* of the domain. A project site at `username.github.io/wee-pole/` can't do that, so pick one:
   - Create a repo named `<username>.github.io` and host BOARD//BOX there (it then lives at the domain root), **or**
   - Point a custom domain at GitHub Pages (Settings → Pages → Custom domain).

   Without this step the app still works, but shows a browser address bar at the top.
4. In Play Console: create the app and upload the `.aab`. Then fill in the listing (screenshots, a description, a privacy policy URL, and the content rating questionnaire). Start with an **internal testing** release to try it on your own phone, then promote it to production.

## Level 3: Apple App Store ($99 / year, Mac required)

Apple doesn't accept plain PWAs, so the site is packaged into a native iOS app with **[Capacitor](https://capacitorjs.com)**. The same route also works for Android if you'd rather skip the Trusted Web Activity approach.

```sh
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "BOARD//BOX" com.yourname.boardbox --web-dir dist
npm run build          # copies the app into dist/
npx cap add ios        # (and/or: npx cap add android)
npx cap sync
npx cap open ios       # opens Xcode
```

In Xcode: choose your team under *Signing & Capabilities* and run it on your iPhone. Then use **Product → Archive → Distribute App** to upload it to App Store Connect, where you fill in the listing and submit for review. After changing the game code, run `npm run build && npx cap sync` again.

**App Review tip:** Apple rejects apps that are "just a website" (guideline 4.2). BOARD//BOX is in good shape here: it works fully offline and has many games, daily challenges and achievements. Adding a native touch such as haptics (`@capacitor/haptics`) on wins and moves makes the case stronger.

---

## Recommended order

1. **Today:** Level 1. Share the link, install it on your phone, and get friends playing.
2. **When it feels solid:** Level 2, since it's the cheapest store.
3. **Later:** Level 3, when you have access to a Mac.

**Online play** (accounts, friends, leaderboards, multiplayer) needs the small server in `server/`, which also hosts the app. Deploying that server (see [ONLINE.md](ONLINE.md)) gives you a URL that works for Level 1 installs *and* includes online play. It's also the URL to give PWABuilder for Level 2. GitHub Pages alone still works, just without the online features.
