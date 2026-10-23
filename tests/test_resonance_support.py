from __future__ import annotations

import hashlib
import sys
import tempfile
import tomllib
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


sys.modules.setdefault("decky", types.SimpleNamespace())

import main


REPO_ROOT = Path(__file__).resolve().parents[1]
APPID = 3259780
CONFIG_PATH = "FFRS/Binaries/Win64/scripts/final_fantasy_resonance_fix.toml"
FIX_PATH = "FFRS/Binaries/Win64/scripts/final_fantasy_resonance_fix.asi"
ORIGINAL_PAYLOAD = b"BA 00 00 00 00 90 90 90"
HORIZONTAL_PAYLOAD = b"BA 01 00 00 00 90 90 90"
UPSTREAM_FIX = b"MZ-test-fix\0" + ORIGINAL_PAYLOAD + b"\0other mod data"
ADJUSTED_FIX = UPSTREAM_FIX.replace(ORIGINAL_PAYLOAD, HORIZONTAL_PAYLOAD)
UPSTREAM_CONFIG = """# Keep unmanaged settings and comments.
super_enable = false

[movies]
enable = false

[background]
enable = true

[hud]
enable = true
constrain = 2

[post_processing]
motion_blur = true

[fonts]
enable = false
"""


class ResonanceInstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.user_home = self.root / "home"
        runtime = self.root / "runtime"
        self.decky_patch = patch.multiple(
            main.decky,
            DECKY_PLUGIN_RUNTIME_DIR=str(runtime),
            DECKY_PLUGIN_DIR=str(REPO_ROOT),
            DECKY_USER_HOME=str(self.user_home),
            create=True,
        )
        self.decky_patch.start()
        self.addCleanup(self.decky_patch.stop)
        self.plugin = main.Plugin()
        self.plugin._ensure_dirs()
        self.plugin._load_catalog()
        self.entry = self.plugin.catalog_by_appid[APPID]

        steamapps = self.user_home / ".local/share/Steam/steamapps"
        self.game_dir = steamapps / "common/FINAL FANTASY RESONANCE"
        self.game_dir.mkdir(parents=True)
        (steamapps / f"appmanifest_{APPID}.acf").write_text(
            f'"AppState" {{ "appid" "{APPID}" "name" "FINAL FANTASY RESONANCE" '
            '"installdir" "FINAL FANTASY RESONANCE" }',
            encoding="utf-8",
        )

        # Exercise the real cached-download, extraction and configuration paths offline.
        # These member names match the verified upstream 0.3.0 ZIP.
        archive_path = self.plugin.cache_dir / self.entry["source"]["asset_name"]
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("winmm.dll", b"MZ-test-loader")
            archive.writestr("scripts/final_fantasy_resonance_fix.asi", UPSTREAM_FIX)
            archive.writestr("scripts/final_fantasy_resonance_fix.toml", UPSTREAM_CONFIG)
            archive.writestr("LICENSES", "test license")
        self.entry["source"]["sha256"] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        adjustment = self.entry["profiles"][0]["binary_patches"][0]
        adjustment["sha256_before"] = hashlib.sha256(UPSTREAM_FIX).hexdigest()
        adjustment["sha256_after"] = hashlib.sha256(ADJUSTED_FIX).hexdigest()

    def test_scan_install_and_uninstall_restore_existing_game_files(self) -> None:
        loader_path = self.game_dir / "FFRS/Binaries/Win64/winmm.dll"
        config_path = self.game_dir / CONFIG_PATH
        config_path.parent.mkdir(parents=True)
        loader_path.write_bytes(b"previous-loader")
        config_path.write_text("# original user config\nsuper_enable = false\n", encoding="utf-8")
        game_exe = loader_path.parent / "FFRS-Win64-Shipping.exe"
        game_exe.write_bytes(b"untouched-game")

        before = self.plugin._scan_library_sync()["supported_games"]
        self.assertEqual(len(before), 1)
        self.assertIn("Experimental", before[0]["display_title"])
        self.assertFalse(before[0]["supports"]["hud_fix"])
        self.assertFalse(before[0]["supports"]["movie_fix"])
        # This is an in-game-resolution preset, not a button that forces a render size.
        self.assertEqual(before[0]["profiles"][0]["resolution"], "In-game")

        result = self.plugin._install_auto_fix_sync(APPID)
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        self.assertTrue(config["super_enable"])
        self.assertTrue(config["movies"]["enable"])
        self.assertFalse(config["hud"]["enable"])
        self.assertEqual(config["hud"]["constrain"], 2)
        self.assertTrue(config["background"]["enable"])
        self.assertTrue(config["post_processing"]["motion_blur"])
        self.assertFalse(config["fonts"]["enable"])
        self.assertEqual(result["launch_option"], 'WINEDLLOVERRIDES="winmm=n,b" %command%')
        self.assertIn("1920x1200", result["profile_label"])
        self.assertEqual(len(result["managed_files"]), 4)
        self.assertEqual((self.game_dir / FIX_PATH).read_bytes(), ADJUSTED_FIX)
        for relative_path in result["managed_files"]:
            self.assertTrue((self.game_dir / relative_path).is_file())
        after = self.plugin._scan_library_sync()["supported_games"][0]
        self.assertEqual(after["status"], "managed")
        self.assertEqual(after["active_profile_id"], result["profile_id"])

        self.plugin._uninstall_fix_sync(APPID)
        self.assertEqual(loader_path.read_bytes(), b"previous-loader")
        self.assertEqual(config_path.read_text(encoding="utf-8"), "# original user config\nsuper_enable = false\n")
        self.assertEqual(game_exe.read_bytes(), b"untouched-game")
        self.assertFalse((self.game_dir / "FFRS/Binaries/Win64/scripts/final_fantasy_resonance_fix.asi").exists())
        self.assertFalse((self.game_dir / "FFRS/Binaries/Win64/LICENSES").exists())
        self.assertIsNone(self.plugin._load_install_record(APPID))

    def test_reinstall_reapplies_hud_off_after_manual_edit(self) -> None:
        self.plugin._install_auto_fix_sync(APPID)
        config_path = self.game_dir / CONFIG_PATH
        config_path.write_text(UPSTREAM_CONFIG, encoding="utf-8")
        (self.game_dir / FIX_PATH).write_bytes(UPSTREAM_FIX)
        self.plugin._install_auto_fix_sync(APPID)
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        self.assertFalse(config["hud"]["enable"])
        self.assertEqual((self.game_dir / FIX_PATH).read_bytes(), ADJUSTED_FIX)

    def test_adjustment_validation_failure_does_not_change_existing_game_files(self) -> None:
        loader = self.game_dir / "FFRS/Binaries/Win64/winmm.dll"
        config = self.game_dir / CONFIG_PATH
        fix = self.game_dir / FIX_PATH
        config.parent.mkdir(parents=True)
        loader.write_bytes(b"existing-loader")
        config.write_bytes(b"existing-config")
        fix.write_bytes(b"existing-fix")
        adjustment = self.entry["profiles"][0]["binary_patches"][0]
        valid = dict(adjustment)
        invalid_fields = (
            ("sha256_before", "0" * 64),
            ("sha256_after", "0" * 64),
            ("find_ascii", "missing payload"),
            ("replace_ascii", "wrong size"),
            ("path", "FFRS/Binaries/Win64/FFRS-Win64-Shipping.exe"),
        )
        for field, value in invalid_fields:
            with self.subTest(field=field):
                adjustment.clear()
                adjustment.update(valid)
                adjustment[field] = value
                with self.assertRaises(RuntimeError):
                    self.plugin._install_auto_fix_sync(APPID)
                self.assertEqual(loader.read_bytes(), b"existing-loader")
                self.assertEqual(config.read_bytes(), b"existing-config")
                self.assertEqual(fix.read_bytes(), b"existing-fix")
                self.assertIsNone(self.plugin._load_install_record(APPID))


class TomlConfigTests(unittest.TestCase):
    def test_missing_root_keys_tables_and_values_stay_in_their_own_tables(self) -> None:
        plugin = main.Plugin.__new__(main.Plugin)
        updates = {"": {"super_enable": True}, "movies": {"enable": True}, "hud": {"enable": False}}
        cases = (
            "# existing comment\n[hud]\nconstrain = 2\n[fonts]\nenable = false",
            "# existing comment\nsuper_enable = false\n[movies]\nenable = false\n"
            "[hud]\nconstrain = 2\n[fonts]\nenable = false",
        )
        for source in cases:
            with self.subTest(source=source), tempfile.TemporaryDirectory() as temp_dir:
                path = Path(temp_dir) / "fix.toml"
                path.write_text(source, encoding="utf-8")
                plugin._apply_config_updates(path, "toml", updates)
                first_write = path.read_text(encoding="utf-8")
                plugin._apply_config_updates(path, "toml", updates)
                second_write = path.read_text(encoding="utf-8")
                config = tomllib.loads(second_write)
                self.assertEqual(first_write, second_write)
                self.assertTrue(config["super_enable"])
                self.assertTrue(config["movies"]["enable"])
                self.assertFalse(config["hud"]["enable"])
                self.assertEqual(config["hud"]["constrain"], 2)
                self.assertEqual(config["fonts"], {"enable": False})
                self.assertIn("# existing comment", second_write)


if __name__ == "__main__":
    unittest.main()
