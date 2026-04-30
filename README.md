# 16:10 Fixes

`16:10 Fixes` is a Decky Loader plugin for SteamOS.

GitHub repo:

- [https://github.com/nucat176/decky-16x10-fixes](https://github.com/nucat176/decky-16x10-fixes)

Latest release downloads:

- [https://github.com/nucat176/decky-16x10-fixes/releases](https://github.com/nucat176/decky-16x10-fixes/releases)

Its job is simple:

- scan your installed Steam games
- look for games that have a known 16:10 fix
- install that fix from inside Game Mode
- apply a safe preset so you do not need to move files around by hand

This release is intentionally curated and cautious.

Right now it supports:

- `Final Fantasy VII Remake Intergrade`
- `Octopath Traveler`
- `Octopath Traveler II`

The long-term goal is still a broader library scanner, but every supported title should have a real, tested install flow.

## What This Plugin Does

When you install a supported game from the plugin, it will:

1. Find the game install folder in your Steam library.
2. Download the matching fix from its public release page.
3. Copy the fix files into the game folder.
4. Patch the `.ini` with a safe preset.
5. Try to add the required Proton launch option automatically.

Current launch options by game:

```text
Final Fantasy VII Remake Intergrade
WINEDLLOVERRIDES="dsound=n,b" %command%

Octopath Traveler
WINEDLLOVERRIDES="d3d11.dll=n,b" %command%

Octopath Traveler II
WINEDLLOVERRIDES="dsound=n,b" %command%
```

## Important Caveats

This is not a universal "force any game to 16:10" tool yet.

Please keep these expectations in mind:

- Some games only fix gameplay and still have odd cutscenes or overlays.
- FF7 is much better with the fix installed, but some transitions can still look wrong.
- The two Octopath fixes keep the HUD centered to 16:9 by design.
- This plugin only manages games that are explicitly in its curated catalog.
- The first release is meant for single-player use cases like FF7, not competitive anti-cheat games.

## Super Simple Install For Normal Users

This is the path a normal Steam Deck owner should use once you package a release zip.

### Step 1: Install Decky Loader

If Decky Loader is not already installed on your Steam Deck, install it first:

- Decky Loader project: [https://github.com/SteamDeckHomebrew/decky-loader](https://github.com/SteamDeckHomebrew/decky-loader)

### Step 2: Download The Plugin Zip

Download the release zip for this plugin to your SteamOS handheld.

The easiest place to get it is the GitHub Releases page:

- [https://github.com/nucat176/decky-16x10-fixes/releases](https://github.com/nucat176/decky-16x10-fixes/releases)

The file should be something like:

```text
16x10-fixes.zip
```

### Step 3: Turn On Decky Developer Mode

On your Steam Deck in Game Mode:

1. Open the `...` quick menu.
2. Open the `Decky` tab.
3. Open the small settings/cog icon in Decky.
4. Turn on `Developer Mode`.

### Step 4: Install The Zip In Decky

Still in Game Mode:

1. Open the Decky tab again.
2. Open the `Developer` section.
3. Choose `Install Plugin from ZIP`.
4. Pick the `16x10-fixes.zip` file you downloaded.

After that, the plugin should appear in your Decky plugin list as `16:10 Fixes`.

## Super Simple Use Instructions

Once the plugin is installed:

1. Make sure one of the supported games is already installed through Steam.
2. Open the `16:10 Fixes` plugin from Decky.
3. Press `Rescan`.
4. Select the game you want to fix.
5. Press `Install Automatically`.
6. Wait for the install to finish.
7. Launch the game normally from Steam.

That is it.

The plugin will handle the file install, apply the curated preset, and try to add the required Proton launch option for you.
If SteamOS refuses the automatic launch-option update, use the `Copy Launch Option`
button in the game's `Technical Details` panel and paste it into Steam `Properties` → `Launch Options`.

## Debug Mode

If install still fails:

1. Turn on `Debug Mode` in the plugin.
2. Try `Install Automatically` again.
3. The plugin will show a traceback on screen in a `Last Debug Report` section.
4. Take a photo of that screen and send it over.

## If Something Goes Wrong

Try these steps in order:

1. Open the plugin and run the scan again.
2. Reinstall the same profile once.
3. If the plugin says the install needs repair, run the install again.
4. If you still have trouble, use `Uninstall Managed Fix` and then install the profile again.

## Build From Source

If you are testing this repo before a packaged release exists, use these steps.

### Requirements

- `pnpm`
- `Node.js`
- a Steam Deck with Decky Loader installed

### Build

From the project folder:

```bash
pnpm install
pnpm build
```

If you want a Decky-ready zip from this repo, run:

```bash
pnpm package
```

That creates:

```text
release/16x10-fixes.zip
```

### Copy To Your Steam Deck Plugin Folder

Copy this project folder to your Decky plugins directory on the Steam Deck:

```text
~/homebrew/plugins/16x10-fixes
```

The folder should contain at least:

- `dist/`
- `main.py`
- `plugin.json`
- `package.json`
- `defaults/catalog.json`

Then restart Decky Loader or reboot the Steam Deck.

## Files The Plugin Currently Manages

For `Final Fantasy VII Remake Intergrade`:

- `End/Binaries/Win64/dsound.dll`
- `End/Binaries/Win64/FF7RemakeFix.asi`
- `End/Binaries/Win64/FF7RemakeFix.ini`
- `End/Binaries/Win64/UltimateASILoader_LICENSE.md`

For `Octopath Traveler`:

- `Octopath_Traveler/Binaries/Win64/d3d11.dll`
- `Octopath_Traveler/Binaries/Win64/OctopathFix.asi`
- `Octopath_Traveler/Binaries/Win64/OctopathFix.ini`

For `Octopath Traveler II`:

- `Octopath_Traveler2/Binaries/Win64/dsound.dll`
- `Octopath_Traveler2/Binaries/Win64/Octopath2Fix.asi`
- `Octopath_Traveler2/Binaries/Win64/Octopath2Fix.ini`
- `Octopath_Traveler2/Binaries/Win64/UltimateASILoader_LICENSE.md`

## Current Scope

This first version is intentionally narrow:

- one curated catalog file
- three supported titles
- scan, install, reinstall, and uninstall support
- beginner-friendly workflow in Game Mode

That is on purpose.

The product only gets more useful if users can trust that "supported" really means supported.

## Credits

- Decky Loader: [https://github.com/SteamDeckHomebrew/decky-loader](https://github.com/SteamDeckHomebrew/decky-loader)
- FF7RemakeFix by Lyall: [https://github.com/Lyall/FF7RemakeFix](https://github.com/Lyall/FF7RemakeFix)
- OctopathFix by Lyall: [https://github.com/Lyall/OctopathFix](https://github.com/Lyall/OctopathFix)
- Octopath2Fix by Lyall: [https://github.com/Lyall/Octopath2Fix](https://github.com/Lyall/Octopath2Fix)
