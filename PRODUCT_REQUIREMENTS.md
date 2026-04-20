# Decky 16:10 Fixes

## Product Thesis

The strongest version of this product is not a magic "force every game to 16:10" button.

The stronger product is a Decky Loader plugin that:

- scans the user's installed Steam library
- matches games against a curated database of known 16:10 and aspect-ratio fixes
- shows what is available, what is safe, and what the tradeoffs are
- installs supported fixes with explicit user consent
- manages follow-up steps like launch options, config files, and uninstall/rollback

This keeps the experience controller-friendly in Game Mode without pretending that every game can be fixed the same way.

## Why This Shape Makes Sense

Different games need very different interventions:

- some just need a config or launch option
- some need a DLL/ASI/BepInEx patch dropped into the game folder
- some need Proton `WINEDLLOVERRIDES`
- some need a game-specific tool that rewrites files or patches memory
- some can render gameplay in 16:10 but still have broken HUDs or movie playback

That last point matters a lot. The "black bars show gameplay behind the movie" issue you mentioned is a perfect example of why this should be a curated compatibility product instead of a generic resolution toggle. A good product has to tell the user whether a fix handles:

- gameplay aspect ratio
- HUD scaling and positioning
- pre-rendered videos
- in-engine cutscenes
- menus and overlays

## Product Goals

- Make known 16:10 fixes discoverable from SteamOS Game Mode.
- Reduce desktop-mode file shuffling and copy/paste setup.
- Give per-game status, install, update, and rollback.
- Prefer sources and methods that are reproducible and verifiable.
- Be honest about caveats instead of implying universal support.

## Non-Goals

- Universal forced 16:10 support for every game.
- Automatic patching of unsupported titles with no compatibility data.
- Bypassing anti-cheat or modifying competitive multiplayer games.
- Rehosting every community mod regardless of permission or source reliability.

## Recommended User Experience

### Main Library View

After scanning installed Steam libraries, the plugin shows:

- `Supported fixes available`
- `Installed and healthy`
- `Installed but outdated`
- `Manual-only fixes`
- `Unsupported / no known fix`

Each game card should show:

- game title and app ID
- fix method
- source
- confidence level
- known issues
- install status

### Game Detail View

Per game, show:

- what the fix changes
- whether it supports `16:10 gameplay`, `HUD fix`, and `movie fix`
- whether it is safe for offline only
- exactly what files will be added or changed
- one-tap actions:
  - `Install`
  - `Update`
  - `Repair`
  - `Uninstall`
  - `Open source page`

### Profiles

For compatible games, offer simple profiles:

- `Steam Deck 16:10`
- `Steam Deck 16:10 + supersample`
- `External 1920x1200`
- `Custom`

A profile should map to actual per-game behavior, not just a label. Example fields:

- target resolution
- whether to center HUD to 16:9
- whether to enable movie fixes
- whether to add Proton launch overrides

## Core Functional Requirements

### 1. Library Detection

The plugin should:

- find Steam library folders
- read installed app manifests
- identify currently installed games
- rescan on demand

It should only recommend fixes for installed titles by default, but optionally allow searching the full catalog.

### 2. Curated Fix Catalog

The product needs a manifest-driven database. Each entry should include:

- `appid`
- `title`
- `source_type` such as `github_release`, `codeberg_release`, `manual_upload`, `custom_installer`
- `source_url`
- `version`
- `sha256` for downloadable assets when available
- `install_strategy`
- `required_files`
- `launch_options`
- `proton_overrides`
- `backup_paths`
- `supports`
  - gameplay_aspect_fix
  - hud_fix
  - movie_fix
  - custom_resolution
- `known_issues`
- `risk_level`
- `multiplayer_safe`

This manifest is the real product. The plugin UI is mostly a friendly execution layer over that data.

### 3. Installation Strategies

The plugin should support a small set of explicit strategies instead of one-off code for every title:

- `extract_archive_to_game_dir`
- `write_ini_file`
- `patch_existing_ini`
- `set_launch_options`
- `append_launch_options`
- `set_proton_override`
- `manual_file_required`

If a fix does not fit these patterns cleanly, it should stay `manual-only` until we intentionally support it.

### 4. Backup and Rollback

Before any install, the plugin should:

- snapshot target files that already exist
- record what it added
- record source version and install timestamp

Rollback should remove added files and restore backed-up files.

### 5. Verification

After install, the plugin should verify:

- expected files exist
- hashes match if applicable
- generated config contains expected settings
- launch options or Proton overrides were applied if that feature is supported

If verification fails, the UI should clearly say what is incomplete.

### 6. Caveat Surfacing

Every fix entry should expose warnings like:

- `Gameplay only; videos remain 16:9`
- `HUD centered, some overlays may be offset`
- `Known movie transition bug`
- `Offline/single-player only`
- `Requires manual download from source`

This is not optional. It is one of the main product values.

## Trust and Safety Requirements

- Never auto-install a fix without clear user consent.
- Never silently modify launch options for unsupported or unverified titles.
- Do not touch games marked as anti-cheat or multiplayer sensitive.
- Show source and version for every installed fix.
- Prefer direct release assets from transparent sources over random mirrors.
- Keep a full local action log so installs are explainable.

## Recommendation on "Automatic Pulls"

I would not make the first release automatically download fixes for the whole library.

The better first behavior is:

1. Scan the library.
2. Match against a curated catalog.
3. Show recommendations.
4. Let the user install per game or in a reviewed batch.

That still feels automatic in a good way, but it avoids surprise file modifications and bad trust optics.

Later, an optional setting could allow:

- `Auto-notify when a supported fix exists`
- `Auto-update already installed fixes`

I would still avoid `auto-install all supported fixes` as a default.

## FF7 Remake as the Design Reference

FF7 Remake is a good anchor title because it shows the real requirements clearly:

- it has a known game-specific fix
- it supports custom resolution and aspect ratio correction
- it needs a Linux/Steam Deck launch override
- it has fix-specific caveats

For FF7 Remake, a strong experience would be:

- detect the game install
- detect whether `FF7RemakeFix` is already present
- offer install from its release source
- write or patch `FF7RemakeFix.ini`
- set or suggest `WINEDLLOVERRIDES=\"dsound=n,b\" %command%`
- offer profiles like `1280x800`, `1920x1200`, or `desktop/native external`
- show known issue notes in the UI

## MVP Scope

Ship a narrow, high-quality MVP.

### MVP Features

- scan installed Steam library
- support 3 to 5 hand-curated games
- install from direct release assets only
- create backups and rollback
- manage per-game profiles
- expose caveats and known issues

### Good MVP Candidate Games

- `Final Fantasy VII Remake` via `FF7RemakeFix`
- `Hades` via `Hephaistos`
- one or two additional titles with simple and well-documented install flows

## Post-MVP

- broader catalog support
- update checks
- optional batch actions
- community manifest contributions
- per-game screenshots and compatibility reports
- Game Details page integration if we want fix actions closer to each title

## Open Questions

- Can we reliably set launch options from Decky across current SteamOS client versions, or should MVP use copy/apply helpers first?
- Which fix sources are stable enough for automatic downloading?
- Do we want a local-only manifest first, or a remotely updateable catalog?
- How much of the install pipeline should be generic versus game-specific?
- What is the minimum metadata needed to prevent a "looks supported but actually broken in cutscenes" experience?

## Recommendation

Yes, I think the right product is a Decky Loader plugin that detects the installed Steam library and matches it against known 16:10 fixes.

But I would frame it as:

`library-aware compatibility manager`

not:

`automatic force-16:10 for everything`

That gives us a product we can actually make reliable.

## References

- Decky Loader: https://github.com/SteamDeckHomebrew/decky-loader
- FF7RemakeFix: https://github.com/Lyall/FF7RemakeFix
- Hephaistos: https://github.com/nbusseneau/hephaistos
- Decky LSFG-VK: https://github.com/xXJSONDeruloXx/decky-lsfg-vk
- SteamTinkerLaunch FlawlessWidescreen integration: https://github.com/sonic2kk/steamtinkerlaunch/wiki/FlawlessWidescreen
