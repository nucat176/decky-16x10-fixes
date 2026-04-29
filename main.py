from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import decky  # type: ignore


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Plugin:
    def __init__(self) -> None:
        self.catalog: dict[str, Any] = {"schema_version": 1, "games": []}
        self.catalog_by_appid: dict[int, dict[str, Any]] = {}
        self.runtime_dir = Path(getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR"))
        self.plugin_dir = Path(getattr(decky, "DECKY_PLUGIN_DIR"))
        self.cache_dir = self.runtime_dir / "cache"
        self.install_records_dir = self.runtime_dir / "installs"
        self.backups_dir = self.runtime_dir / "backups"
        self.scan_cache_path = self.runtime_dir / "last_scan.json"
        self.last_error_path = self.runtime_dir / "last_error.json"

    async def _main(self) -> None:
        self._ensure_dirs()
        self._load_catalog()
        decky.logger.info("16:10 Fixes loaded.")

    async def _unload(self) -> None:
        decky.logger.info("16:10 Fixes unloaded.")

    async def _uninstall(self) -> None:
        decky.logger.info("16:10 Fixes uninstalled.")

    async def _migration(self) -> None:
        decky.logger.info("16:10 Fixes migration complete.")

    async def scan_library(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._run_with_debug_capture, "scan_library", self._scan_library_sync)

    async def install_fix(self, appid: int, profile_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._run_with_debug_capture, "install_fix", self._install_fix_sync, int(appid), profile_id)

    async def install_auto_fix(self, appid: int) -> dict[str, Any]:
        return await asyncio.to_thread(self._run_with_debug_capture, "install_auto_fix", self._install_auto_fix_sync, int(appid))

    async def uninstall_fix(self, appid: int) -> dict[str, Any]:
        return await asyncio.to_thread(self._run_with_debug_capture, "uninstall_fix", self._uninstall_fix_sync, int(appid))

    async def get_last_debug_report(self) -> dict[str, Any] | None:
        if not self.last_error_path.exists():
            return None

        with self.last_error_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _ensure_dirs(self) -> None:
        for path in (self.runtime_dir, self.cache_dir, self.install_records_dir, self.backups_dir):
            path.mkdir(parents=True, exist_ok=True)

    def _load_catalog(self) -> None:
        catalog_path = self.plugin_dir / "defaults" / "catalog.json"
        with catalog_path.open("r", encoding="utf-8") as handle:
            self.catalog = json.load(handle)
        self.catalog_by_appid = {
            int(game["appid"]): game
            for game in self.catalog.get("games", [])
        }

    def _write_last_error(self, payload: dict[str, Any]) -> None:
        with self.last_error_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    def _clear_last_error(self) -> None:
        if self.last_error_path.exists():
            self.last_error_path.unlink()

    def _run_with_debug_capture(self, action: str, fn: Any, *args: Any) -> Any:
        try:
            result = fn(*args)
            self._clear_last_error()
            return result
        except Exception as error:
            error_payload = {
                "captured_at": utc_now_iso(),
                "action": action,
                "message": str(error),
                "traceback": traceback.format_exc(),
                "args": list(args),
            }
            self._write_last_error(error_payload)
            decky.logger.error(f"{action} failed: {error_payload['traceback']}")
            raise

    def _steam_root_candidates(self) -> list[Path]:
        user_home = Path(getattr(decky, "DECKY_USER_HOME"))
        return [
            user_home / ".local" / "share" / "Steam",
            user_home / ".steam" / "steam",
            user_home / ".steam" / "root",
        ]

    def _get_steam_library_paths(self) -> tuple[list[str], list[Path]]:
        steam_roots: list[Path] = []
        library_paths: list[Path] = []

        for candidate in self._steam_root_candidates():
            steamapps_dir = candidate / "steamapps"
            if steamapps_dir.exists():
                steam_roots.append(candidate)
                library_paths.append(candidate)
                extra_libraries = self._parse_libraryfolders_vdf(steamapps_dir / "libraryfolders.vdf")
                library_paths.extend(extra_libraries)

        unique_roots: list[Path] = []
        seen_roots: set[str] = set()
        for root in steam_roots:
            key = str(root)
            if key not in seen_roots:
                seen_roots.add(key)
                unique_roots.append(root)

        unique_libraries: list[Path] = []
        seen_libraries: set[str] = set()
        for library in library_paths:
            key = str(library)
            if key not in seen_libraries:
                seen_libraries.add(key)
                unique_libraries.append(library)

        return [str(root) for root in unique_roots], unique_libraries

    def _parse_libraryfolders_vdf(self, vdf_path: Path) -> list[Path]:
        if not vdf_path.exists():
            return []

        with vdf_path.open("r", encoding="utf-8", errors="ignore") as handle:
            content = handle.read()

        matches = re.findall(r'"path"\s*"([^"]+)"', content, re.IGNORECASE)
        libraries: list[Path] = []
        for value in matches:
            normalized = value.replace("\\\\", "/").replace("\\", "/")
            path = Path(normalized)
            if path.exists() and (path / "steamapps").exists():
                libraries.append(path)
        return libraries

    def _parse_appmanifest(self, manifest_path: Path) -> dict[str, str] | None:
        with manifest_path.open("r", encoding="utf-8", errors="ignore") as handle:
            content = handle.read()

        keys = ("appid", "name", "installdir")
        parsed: dict[str, str] = {}
        for key in keys:
            match = re.search(rf'"{re.escape(key)}"\s*"([^"]*)"', content)
            if not match:
                return None
            parsed[key] = match.group(1)
        return parsed

    def _scan_library_sync(self) -> dict[str, Any]:
        steam_roots, libraries = self._get_steam_library_paths()
        supported_games: list[dict[str, Any]] = []
        installed_games_count = 0

        for library in libraries:
            steamapps_dir = library / "steamapps"
            if not steamapps_dir.exists():
                continue

            for manifest_path in sorted(steamapps_dir.glob("appmanifest_*.acf")):
                parsed = self._parse_appmanifest(manifest_path)
                if not parsed:
                    continue

                installed_games_count += 1
                appid = int(parsed["appid"])
                catalog_entry = self.catalog_by_appid.get(appid)
                if not catalog_entry:
                    continue

                install_path = steamapps_dir / "common" / parsed["installdir"]
                install_state = self._get_install_state(appid, install_path, catalog_entry)
                active_profile_id = install_state.get("active_profile_id")
                active_profile_label = None
                for profile in catalog_entry.get("profiles", []):
                    if profile["id"] == active_profile_id:
                        active_profile_label = profile["label"]
                        break

                supported_games.append({
                    "appid": appid,
                    "slug": catalog_entry["slug"],
                    "title": parsed["name"],
                    "display_title": catalog_entry.get("display_title", parsed["name"]),
                    "install_path": str(install_path),
                    "library_path": str(library),
                    "source_name": f'{catalog_entry["source"]["name"]} {catalog_entry["source"]["version"]}',
                    "source_url": catalog_entry["source"]["source_url"],
                    "supports": catalog_entry.get("supports", {}),
                    "install_notes": catalog_entry.get("install_notes", []),
                    "known_issues": catalog_entry.get("known_issues", []),
                    "profiles": [
                        {
                            "id": profile["id"],
                            "label": profile["label"],
                            "description": profile["description"],
                            "resolution": profile["resolution"],
                        }
                        for profile in catalog_entry.get("profiles", [])
                    ],
                    "launch_option": catalog_entry["launch_options"]["required"],
                    "launch_option_token": catalog_entry["launch_options"]["token"],
                    "status": install_state["status"],
                    "status_label": install_state["status_label"],
                    "managed_files_total": install_state["managed_files_total"],
                    "managed_files_present": install_state["managed_files_present"],
                    "active_profile_id": active_profile_id,
                    "active_profile_label": active_profile_label,
                })

        supported_games.sort(key=lambda game: game["display_title"].lower())

        result = {
            "scanned_at": utc_now_iso(),
            "steam_roots": steam_roots,
            "libraries": [str(library) for library in libraries],
            "installed_games_count": installed_games_count,
            "supported_games_count": len(supported_games),
            "supported_games": supported_games,
        }

        with self.scan_cache_path.open("w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)

        return result

    def _get_install_record_path(self, appid: int) -> Path:
        return self.install_records_dir / f"{appid}.json"

    def _load_install_record(self, appid: int) -> dict[str, Any] | None:
        record_path = self._get_install_record_path(appid)
        if not record_path.exists():
            return None
        with record_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_install_record(self, appid: int, payload: dict[str, Any]) -> None:
        record_path = self._get_install_record_path(appid)
        with record_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    def _get_install_state(self, appid: int, install_path: Path, catalog_entry: dict[str, Any]) -> dict[str, Any]:
        metadata = self._load_install_record(appid)
        expected_files = [install_path / relative_path for relative_path in catalog_entry.get("managed_files", [])]
        present_count = sum(1 for path in expected_files if path.exists())

        if metadata and present_count == len(expected_files):
            status = "managed"
            status_label = "Installed by this plugin"
        elif metadata and present_count < len(expected_files):
            status = "repair"
            status_label = "Needs repair"
        elif present_count > 0:
            status = "external"
            status_label = "Fix detected, but not managed by this plugin"
        else:
            status = "available"
            status_label = "Ready to install"

        return {
            "status": status,
            "status_label": status_label,
            "managed_files_total": len(expected_files),
            "managed_files_present": present_count,
            "active_profile_id": metadata.get("profile_id") if metadata else None,
        }

    def _find_game_install(self, appid: int) -> dict[str, Any]:
        scan = self._scan_library_sync()
        for game in scan["supported_games"]:
            if int(game["appid"]) == int(appid):
                return game
        raise RuntimeError("That supported game was not found in the installed Steam library scan.")

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _download_file(self, url: str, destination: Path, expected_sha256: str | None = None) -> None:
        if destination.exists():
            if expected_sha256:
                actual_digest = self._sha256_file(destination)
                if actual_digest == expected_sha256:
                    return
                destination.unlink()
            else:
                return

        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination = destination.with_suffix(destination.suffix + ".tmp")
        if temp_destination.exists():
            temp_destination.unlink()

        curl_env = dict(os.environ)
        for env_key in (
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "PYTHONHOME",
            "PYTHONPATH",
            "PYTHONUSERBASE",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
        ):
            curl_env.pop(env_key, None)

        curl_env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        curl_env["HOME"] = str(Path(getattr(decky, "DECKY_USER_HOME")))

        def run_curl_command(extra_args: list[str]) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [
                    "/usr/bin/curl",
                    "-L",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "-A",
                    "decky-16x10-fixes/0.1.7",
                    *extra_args,
                    "-o",
                    str(temp_destination),
                    url,
                ],
                capture_output=True,
                text=True,
                check=False,
                env=curl_env,
            )

        curl_result = run_curl_command([])
        if curl_result.returncode != 0:
            stderr = curl_result.stderr.strip()
            stdout = curl_result.stdout.strip()
            decky.logger.warning(f"curl download failed for {url}: {stderr or stdout or curl_result.returncode}")

            ssl_keywords = ("SSL", "certificate", "issuer", "tls")
            should_retry_insecure = any(keyword.lower() in stderr.lower() for keyword in ssl_keywords)
            if should_retry_insecure and "github.com" in url:
                if temp_destination.exists():
                    temp_destination.unlink()
                insecure_result = run_curl_command(["--insecure"])
                if insecure_result.returncode != 0:
                    if temp_destination.exists():
                        temp_destination.unlink()
                    raise RuntimeError(
                        "The plugin could not download the fix archive from GitHub. "
                        f"curl said: {insecure_result.stderr.strip() or insecure_result.stdout.strip() or insecure_result.returncode}"
                    )
                curl_result = insecure_result
            else:
                if temp_destination.exists():
                    temp_destination.unlink()
                raise RuntimeError(
                    "The plugin could not download the fix archive from GitHub. "
                    f"curl said: {stderr or stdout or curl_result.returncode}"
                )

        if expected_sha256:
            actual_digest = self._sha256_file(temp_destination)
            if actual_digest != expected_sha256:
                temp_destination.unlink(missing_ok=True)
                raise RuntimeError(
                    "The downloaded fix archive did not match the expected checksum, so the install was stopped."
                )

        shutil.move(str(temp_destination), str(destination))

    def _serialise_ini_value(self, value: Any) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    def _apply_ini_updates(self, ini_path: Path, updates: dict[str, dict[str, Any]]) -> None:
        with ini_path.open("r", encoding="utf-8", errors="ignore") as handle:
            lines = handle.readlines()

        found_sections: set[str] = set()
        seen_keys: set[tuple[str, str]] = set()
        current_section = ""
        output_lines: list[str] = []

        for line in lines:
            section_match = re.match(r"\[(.+?)\]", line.strip())
            if section_match:
                current_section = section_match.group(1)
                found_sections.add(current_section)
                output_lines.append(line)
                continue

            if current_section in updates:
                replaced = False
                for key, value in updates[current_section].items():
                    key_match = re.match(rf"(\s*{re.escape(key)}\s*=\s*)(.*)$", line)
                    if key_match:
                        output_lines.append(f"{key_match.group(1)}{self._serialise_ini_value(value)}\n")
                        seen_keys.add((current_section, key))
                        replaced = True
                        break
                if replaced:
                    continue

            output_lines.append(line)

        appended_sections: set[str] = set()
        for section_name, values in updates.items():
            missing_keys = [key for key in values if (section_name, key) not in seen_keys]
            if not missing_keys:
                continue

            if section_name not in found_sections and section_name not in appended_sections:
                output_lines.append(f"\n[{section_name}]\n")
                appended_sections.add(section_name)

            for key in missing_keys:
                output_lines.append(f"{key} = {self._serialise_ini_value(values[key])}\n")

        with ini_path.open("w", encoding="utf-8") as handle:
            handle.writelines(output_lines)

    def _get_auto_profile(self, catalog_entry: dict[str, Any]) -> dict[str, Any]:
        profiles = catalog_entry.get("profiles", [])
        auto_profile_id = catalog_entry.get("auto_profile_id")
        if auto_profile_id:
            profile = next((item for item in profiles if item["id"] == auto_profile_id), None)
            if profile:
                return profile

        profile = next((item for item in profiles if item.get("resolution") == "Auto"), None)
        if profile:
            return profile

        if profiles:
            return profiles[0]

        raise RuntimeError("No install profiles are configured for this game.")

    def _install_auto_fix_sync(self, appid: int) -> dict[str, Any]:
        catalog_entry = self.catalog_by_appid.get(appid)
        if not catalog_entry:
            raise RuntimeError("That game is not in the curated fix catalog yet.")

        profile = self._get_auto_profile(catalog_entry)
        return self._install_fix_sync(appid, profile["id"])

    def _install_fix_sync(self, appid: int, profile_id: str) -> dict[str, Any]:
        catalog_entry = self.catalog_by_appid.get(appid)
        if not catalog_entry:
            raise RuntimeError("That game is not in the curated fix catalog yet.")

        game = self._find_game_install(appid)
        install_path = Path(game["install_path"])
        if not install_path.exists():
            raise RuntimeError("The game folder could not be found on disk.")

        profile = next(
            (item for item in catalog_entry.get("profiles", []) if item["id"] == profile_id),
            None,
        )
        if not profile:
            raise RuntimeError("That install profile is not available for this game.")

        source = catalog_entry["source"]
        cache_path = self.cache_dir / source["asset_name"]
        self._download_file(source["download_url"], cache_path, source.get("sha256"))

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = self.backups_dir / str(appid) / timestamp
        backup_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(cache_path, "r") as archive:
            archive_members = set(archive.namelist())
            for relative_path in catalog_entry.get("managed_files", []):
                if relative_path not in archive_members:
                    raise RuntimeError(f"The release archive is missing {relative_path}.")

                destination = install_path / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)

                if destination.exists():
                    backup_target = backup_dir / relative_path
                    backup_target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, backup_target)

                try:
                    with archive.open(relative_path, "r") as source_handle, destination.open("wb") as dest_handle:
                        shutil.copyfileobj(source_handle, dest_handle)
                except PermissionError as error:
                    raise RuntimeError(
                        "The plugin was not able to write into the game folder. "
                        "Please make sure the game is fully closed and try again."
                    ) from error

        ini_relative_path = catalog_entry["config"]["path"]
        ini_path = install_path / ini_relative_path
        if not ini_path.exists():
            raise RuntimeError(
                "The FF7RemakeFix.ini file was not found after extraction, so the plugin could not finish setup."
            )
        self._apply_ini_updates(ini_path, profile["config_updates"])

        install_record = {
            "appid": appid,
            "slug": catalog_entry["slug"],
            "profile_id": profile["id"],
            "profile_label": profile["label"],
            "installed_at": utc_now_iso(),
            "install_path": str(install_path),
            "backup_dir": str(backup_dir),
            "managed_files": catalog_entry.get("managed_files", []),
            "source_name": source["name"],
            "source_version": source["version"],
            "source_url": source["source_url"],
        }
        self._write_install_record(appid, install_record)

        return {
            "appid": appid,
            "game_title": game["display_title"],
            "profile_id": profile["id"],
            "profile_label": profile["label"],
            "launch_option": catalog_entry["launch_options"]["required"],
            "launch_option_token": catalog_entry["launch_options"]["token"],
            "backup_dir": str(backup_dir),
            "managed_files": catalog_entry.get("managed_files", []),
            "message": f'Installed {source["name"]} with the "{profile["label"]}" profile.',
        }

    def _uninstall_fix_sync(self, appid: int) -> dict[str, Any]:
        metadata = self._load_install_record(appid)
        if not metadata:
            raise RuntimeError("This game is not currently managed by the plugin.")

        catalog_entry = self.catalog_by_appid.get(appid)
        if not catalog_entry:
            raise RuntimeError("The catalog entry for this game is missing.")

        install_path = Path(metadata["install_path"])
        backup_dir = Path(metadata["backup_dir"])

        removed_files: list[str] = []
        for relative_path in metadata.get("managed_files", []):
            target_path = install_path / relative_path
            if target_path.exists():
                target_path.unlink()
                removed_files.append(relative_path)

        if backup_dir.exists():
            for backup_file in backup_dir.rglob("*"):
                if not backup_file.is_file():
                    continue

                relative_path = backup_file.relative_to(backup_dir)
                destination = install_path / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup_file, destination)

        record_path = self._get_install_record_path(appid)
        if record_path.exists():
            record_path.unlink()

        return {
            "appid": appid,
            "game_title": catalog_entry.get("display_title", metadata.get("slug", "Game")),
            "removed_files": removed_files,
            "message": "Removed the managed fix files and restored any backups created during install.",
        }
