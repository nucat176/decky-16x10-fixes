import {
  ButtonItem,
  DialogButton,
  Navigation,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaExpandArrowsAlt } from "react-icons/fa";

type InstallStatus = "available" | "managed" | "external" | "repair";

type FixProfile = {
  id: string;
  label: string;
  description: string;
  resolution: string;
};

type SupportedGame = {
  appid: number;
  slug: string;
  title: string;
  display_title: string;
  install_path: string;
  library_path: string;
  source_name: string;
  source_url: string;
  supports: Record<string, boolean>;
  install_notes: string[];
  known_issues: string[];
  profiles: FixProfile[];
  launch_option: string;
  launch_option_token: string;
  status: InstallStatus;
  status_label: string;
  managed_files_total: number;
  managed_files_present: number;
  active_profile_id?: string | null;
  active_profile_label?: string | null;
};

type ScanResult = {
  scanned_at: string | null;
  steam_roots: string[];
  libraries: string[];
  installed_games_count: number;
  supported_games_count: number;
  supported_games: SupportedGame[];
};

type InstallResult = {
  appid: number;
  game_title: string;
  profile_id: string;
  profile_label: string;
  launch_option: string;
  launch_option_token: string;
  backup_dir: string;
  managed_files: string[];
  message: string;
};

type UninstallResult = {
  appid: number;
  game_title: string;
  removed_files: string[];
  message: string;
};

type AppDetailsResponse = {
  strLaunchOptions?: string;
};

const scanLibrary = callable<[], ScanResult>("scan_library");
const installFix = callable<[appid: number, profileId: string], InstallResult>("install_fix");
const uninstallFix = callable<[appid: number], UninstallResult>("uninstall_fix");

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mergeLaunchOptions(existing: string, required: string, token: string): { changed: boolean; value: string } {
  const trimmedExisting = existing.trim();
  if (trimmedExisting.includes(token)) {
    return { changed: false, value: trimmedExisting };
  }

  if (trimmedExisting.length === 0) {
    return { changed: true, value: required };
  }

  const requiredPrefix = required.replace(/\s*%command%/g, "").trim();
  if (trimmedExisting.includes("%command%")) {
    return {
      changed: true,
      value: trimmedExisting.replace("%command%", `${requiredPrefix} %command%`),
    };
  }

  return {
    changed: true,
    value: `${requiredPrefix} ${trimmedExisting}`.trim(),
  };
}

async function readCurrentLaunchOptions(appid: number): Promise<string> {
  return await new Promise<string>((resolve) => {
    let unregister: () => void = () => {};
    let settled = false;

    const settle = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      unregister();
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => settle(""), 1500);
    const registration = SteamClient.Apps.RegisterForAppDetails(
      appid,
      (detail: AppDetailsResponse) => settle(detail?.strLaunchOptions ?? ""),
    );
    unregister = registration.unregister;
  });
}

async function ensureLaunchOption(appid: number, required: string, token: string): Promise<{ changed: boolean }> {
  const current = await readCurrentLaunchOptions(appid);
  const next = mergeLaunchOptions(current, required, token);
  if (!next.changed) {
    return { changed: false };
  }

  SteamClient.Apps.SetAppLaunchOptions(appid, next.value);
  return { changed: true };
}

function SupportSummary({ game }: { game: SupportedGame }) {
  const facts: string[] = [];
  if (game.supports.gameplay_aspect_fix) {
    facts.push("Gameplay 16:10");
  }
  if (game.supports.hud_fix) {
    facts.push("HUD fix");
  }
  if (game.supports.movie_fix) {
    facts.push("Movie fix");
  }
  if (game.supports.custom_resolution) {
    facts.push("Custom resolutions");
  }

  return (
    <div style={{ fontSize: "12px", opacity: 0.8, lineHeight: 1.4 }}>
      {facts.join(" • ")}
    </div>
  );
}

function DetailsSection(props: {
  game: SupportedGame;
  busy: boolean;
  onInstall: (profileId: string) => Promise<void>;
  onUninstall: () => Promise<void>;
}) {
  const { game, busy, onInstall, onUninstall } = props;

  return (
    <PanelSection title="Game Details">
      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: 700 }}>{game.display_title}</div>
          <div style={{ fontSize: "12px", opacity: 0.8 }}>{game.status_label}</div>
          {game.active_profile_label ? (
            <div style={{ fontSize: "12px", opacity: 0.8 }}>
              Active profile: {game.active_profile_label}
            </div>
          ) : null}
          <SupportSummary game={game} />

          <div style={{ fontSize: "12px", opacity: 0.75 }}>Install path</div>
          <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-word" }}>
            {game.install_path}
          </div>

          <div style={{ fontSize: "12px", opacity: 0.75 }}>Required launch option</div>
          <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-word" }}>
            {game.launch_option}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <DialogButton
              onClick={() => Navigation.NavigateToExternalWeb(game.source_url)}
              style={{ minWidth: "180px" }}
            >
              Open Source Page
            </DialogButton>
            {game.status === "managed" || game.status === "repair" ? (
              <DialogButton onClick={() => void onUninstall()} disabled={busy} style={{ minWidth: "180px" }}>
                {busy ? "Working..." : "Uninstall Managed Fix"}
              </DialogButton>
            ) : null}
          </div>
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontWeight: 700 }}>Install Profiles</div>
          {game.profiles.map((profile) => (
            <DialogButton
              key={profile.id}
              onClick={() => void onInstall(profile.id)}
              disabled={busy}
              style={{ textAlign: "left", justifyContent: "flex-start" }}
            >
              {busy ? "Working..." : `${profile.label} (${profile.resolution})`}
            </DialogButton>
          ))}
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontWeight: 700 }}>What The Plugin Does</div>
          <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5 }}>
            {game.install_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontWeight: 700 }}>Known Caveats</div>
          <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5 }}>
            {game.known_issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function Content() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAppId, setBusyAppId] = useState<number | null>(null);

  const refreshScan = async () => {
    setLoading(true);
    try {
      const nextScan = await scanLibrary();
      setScan(nextScan);

      if (nextScan.supported_games.length === 0) {
        setSelectedAppId(null);
      } else if (
        selectedAppId === null ||
        !nextScan.supported_games.some((game) => game.appid === selectedAppId)
      ) {
        setSelectedAppId(nextScan.supported_games[0].appid);
      }
    } catch (error) {
      toaster.toast({
        title: "Scan failed",
        body: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshScan();
  }, []);

  const selectedGame =
    scan?.supported_games.find((game) => game.appid === selectedAppId) ?? null;

  const handleInstall = async (profileId: string) => {
    if (!selectedGame) {
      return;
    }

    setBusyAppId(selectedGame.appid);
    try {
      const result = await installFix(selectedGame.appid, profileId);
      let launchOptionBody = "The fix files were installed.";
      try {
        const launchOptionResult = await ensureLaunchOption(
          selectedGame.appid,
          result.launch_option,
          result.launch_option_token,
        );

        launchOptionBody = launchOptionResult.changed
          ? `${result.message} Launch options were updated too.`
          : `${result.message} Your launch options already looked correct.`;
      } catch (launchOptionError) {
        launchOptionBody =
          `${result.message} The plugin could not update Steam launch options automatically. ` +
          `Please set this manually in FF7 Properties > Launch Options: ${result.launch_option}`;
        console.error("Launch option auto-update failed:", launchOptionError);
      }

      toaster.toast({
        title: "Fix installed",
        body: launchOptionBody,
      });
      await refreshScan();
    } catch (error) {
      toaster.toast({
        title: "Install failed",
        body: getErrorMessage(error),
      });
    } finally {
      setBusyAppId(null);
    }
  };

  const handleUninstall = async () => {
    if (!selectedGame) {
      return;
    }

    setBusyAppId(selectedGame.appid);
    try {
      const result = await uninstallFix(selectedGame.appid);
      toaster.toast({
        title: "Fix removed",
        body: result.message,
      });
      await refreshScan();
    } catch (error) {
      toaster.toast({
        title: "Uninstall failed",
        body: getErrorMessage(error),
      });
    } finally {
      setBusyAppId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Library Scan">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => void refreshScan()}
          >
            {loading ? "Scanning installed games..." : "Scan Installed Steam Library"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
            {scan ? (
              <>
                <div>Installed games found: {scan.installed_games_count}</div>
                <div>Supported games found: {scan.supported_games_count}</div>
                <div>Steam libraries checked: {scan.libraries.length}</div>
              </>
            ) : (
              <div>Run a scan to look for supported 16:10 fixes.</div>
            )}
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Supported Installed Games">
        {scan && scan.supported_games.length > 0 ? (
          scan.supported_games.map((game) => (
            <PanelSectionRow key={game.appid}>
              <ButtonItem
                layout="below"
                description={`${game.status_label} • ${game.managed_files_present}/${game.managed_files_total} managed files found`}
                onClick={() => setSelectedAppId(game.appid)}
              >
                {game.display_title}
              </ButtonItem>
            </PanelSectionRow>
          ))
        ) : (
          <PanelSectionRow>
            <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
              This MVP currently ships with one curated game entry: FF7 Remake.
              If the game is installed and the scan still shows nothing, double-check that
              Steam can see the library folder and try scanning again.
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      {selectedGame ? (
        <DetailsSection
          game={selectedGame}
          busy={busyAppId === selectedGame.appid}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
        />
      ) : null}
    </div>
  );
}

export default definePlugin(() => {
  return {
    name: "16:10 Fixes",
    titleView: <div className={staticClasses.Title}>16:10 Fixes</div>,
    content: <Content />,
    icon: <FaExpandArrowsAlt />,
  };
});
