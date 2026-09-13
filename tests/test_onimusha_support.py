from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


sys.modules.setdefault("decky", types.SimpleNamespace())

from main import Plugin


REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((REPO_ROOT / "defaults" / "catalog.json").read_text(encoding="utf-8"))
ONIMUSHA = next(game for game in CATALOG["games"] if game["appid"] == 2638890)


class OnimushaCatalogTests(unittest.TestCase):
    def test_catalog_pins_the_verified_reframework_asset(self) -> None:
        self.assertEqual(ONIMUSHA["slug"], "onimusha-way-of-the-sword")
        self.assertEqual(ONIMUSHA["source"]["version"], "nightly-01417")
        self.assertEqual(
            ONIMUSHA["source"]["sha256"],
            "ae8208c299422ae88ec520082ac1721fc7c06f41ef163ca1eeef10650fee0e7c",
        )
        self.assertEqual(ONIMUSHA["managed_files"], ["dinput8.dll", "re2_fw_config.txt"])

    def test_profile_enables_16_10_fill_without_claiming_ui_or_movie_fixes(self) -> None:
        profile = ONIMUSHA["profiles"][0]
        updates = profile["config_updates"]

        self.assertTrue(updates["Graphics_UltrawideFix"])
        self.assertFalse(updates["Graphics_Ultrawide16x10Mode"])
        self.assertFalse(updates["Graphics_UltrawideConstrainUI"])
        self.assertFalse(ONIMUSHA["supports"]["hud_fix"])
        self.assertFalse(ONIMUSHA["supports"]["movie_fix"])


class ReframeworkConfigTests(unittest.TestCase):
    def test_key_value_updates_are_idempotent_and_preserve_unmanaged_settings(self) -> None:
        plugin = Plugin.__new__(Plugin)
        updates = ONIMUSHA["profiles"][0]["config_updates"]

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "re2_fw_config.txt"
            config_path.write_text(
                "Graphics_UltrawideFix=false\nCustom_UserSetting=keep-me\n",
                encoding="utf-8",
            )

            plugin._apply_key_value_updates(config_path, updates)
            first_write = config_path.read_text(encoding="utf-8")
            plugin._apply_key_value_updates(config_path, updates)
            second_write = config_path.read_text(encoding="utf-8")

        self.assertEqual(first_write, second_write)
        self.assertIn("Graphics_UltrawideFix=true\n", second_write)
        self.assertIn("Graphics_Ultrawide16x10Mode=false\n", second_write)
        self.assertIn("Custom_UserSetting=keep-me\n", second_write)


if __name__ == "__main__":
    unittest.main()
