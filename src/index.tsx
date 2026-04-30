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

type DebugReport = {
  captured_at: string;
  action: string;
  message: string;
  traceback: string;
  args: unknown[];
};

type AppDetailsResponse = {
  strLaunchOptions?: string;
};

const scanLibrary = callable<[], ScanResult>("scan_library");
const installAutoFix = callable<[appid: number], InstallResult>("install_auto_fix");
const uninstallFix = callable<[appid: number], UninstallResult>("uninstall_fix");
const getLastDebugReport = callable<[], DebugReport | null>("get_last_debug_report");

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function copyToClipboard(text: string): Promise<boolean> {
  const tempInput = document.createElement("input");
  tempInput.value = text;
  tempInput.style.position = "absolute";
  tempInput.style.left = "-9999px";
  document.body.appendChild(tempInput);

  try {
    tempInput.focus();
    tempInput.select();

    try {
      if (document.execCommand("copy")) {
        return true;
      }
    } catch (copyError) {
      console.error("execCommand copy failed:", copyError);
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (clipboardError) {
      console.error("navigator clipboard copy failed:", clipboardError);
      return false;
    }
  } finally {
    document.body.removeChild(tempInput);
  }
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

function CopyLaunchOptionButton({ launchOption }: { launchOption: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!showSuccess) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setShowSuccess(false);
    }, 2500);

    return () => window.clearTimeout(timerId);
  }, [showSuccess]);

  const handleCopy = async () => {
    if (isLoading || showSuccess) {
      return;
    }

    setIsLoading(true);
    try {
      const copied = await copyToClipboard(launchOption);
      if (!copied) {
        toaster.toast({
          title: "Copy failed",
          body: "The plugin could not copy the launch option to the clipboard.",
        });
        return;
      }

      setShowSuccess(true);
      toaster.toast({
        title: "Copied",
        body: "The FF7 launch option is now in your clipboard.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogButton onClick={() => void handleCopy()} disabled={isLoading || showSuccess} style={{ minWidth: "180px" }}>
      {showSuccess ? "Copied Launch Option" : isLoading ? "Copying..." : "Copy Launch Option"}
    </DialogButton>
  );
}

function getStatusPresentation(game: SupportedGame): {
  label: string;
  background: string;
  color: string;
} {
  switch (game.status) {
    case "managed":
      return {
        label: game.active_profile_label ? `Installed · ${game.active_profile_label}` : "Installed",
        background: "rgba(64, 160, 93, 0.18)",
        color: "#b8efc6",
      };
    case "repair":
      return {
        label: "Needs repair",
        background: "rgba(196, 143, 44, 0.18)",
        color: "#f6d482",
      };
    case "external":
      return {
        label: "Detected outside plugin",
        background: "rgba(85, 135, 214, 0.18)",
        color: "#b7d4ff",
      };
    case "available":
    default:
      return {
        label: "Not installed",
        background: "rgba(255, 255, 255, 0.08)",
        color: "#f0f3f7",
      };
  }
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
  debugMode: boolean;
  lastDebugReport: DebugReport | null;
  onInstall: () => Promise<void>;
  onUninstall: () => Promise<void>;
  showTitle?: boolean;
}) {
  const { game, busy, debugMode, lastDebugReport, onInstall, onUninstall, showTitle = true } = props;
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const status = getStatusPresentation(game);

  return (
    <PanelSection title={showTitle ? "Game Details" : game.display_title}>
      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {showTitle ? (
                <div style={{ fontWeight: 700, fontSize: "16px" }}>{game.display_title}</div>
              ) : null}
              <SupportSummary game={game} />
            </div>
            <div
              style={{
                background: status.background,
                color: status.color,
                borderRadius: "999px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 700,
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {status.label}
            </div>
          </div>

          <div style={{ fontSize: "12px", opacity: 0.8, lineHeight: 1.5 }}>
            Install uses your current display automatically. You should not need to pick a resolution.
          </div>
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          description="Uses the automatic display profile and then tries to add the required FF7 launch option."
          onClick={() => void onInstall()}
          disabled={busy}
        >
          {busy
            ? "Installing..."
            : game.status === "repair"
              ? "Repair Automatically"
              : game.status === "managed"
                ? "Reinstall Automatically"
                : "Install Automatically"}
        </ButtonItem>
      </PanelSectionRow>

      {game.status === "managed" || game.status === "repair" ? (
        <PanelSectionRow>
          <DialogButton onClick={() => void onUninstall()} disabled={busy} style={{ minWidth: "220px" }}>
            {busy ? "Working..." : "Uninstall Managed Fix"}
          </DialogButton>
        </PanelSectionRow>
      ) : null}

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: 700 }}>Notes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", opacity: 0.75, fontWeight: 700 }}>What happens</div>
            <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5 }}>
              {game.install_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", opacity: 0.75, fontWeight: 700 }}>Things to know</div>
            <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5 }}>
              {game.known_issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      </PanelSectionRow>

      {debugMode && lastDebugReport ? (
        <PanelSectionRow>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontWeight: 700 }}>Last Debug Report</div>
            <div style={{ fontSize: "12px", opacity: 0.75 }}>
              Captured: {lastDebugReport.captured_at} • Action: {lastDebugReport.action}
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "10px",
                lineHeight: 1.4,
                background: "rgba(255,255,255,0.06)",
                borderRadius: "8px",
                padding: "10px",
                maxHeight: "320px",
                overflowY: "auto",
              }}
            >
              {lastDebugReport.traceback}
            </div>
          </div>
        </PanelSectionRow>
      ) : null}

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
          <DialogButton
            onClick={() => setShowTechnicalDetails((current) => !current)}
            style={{ minWidth: "220px" }}
          >
            {showTechnicalDetails ? "Hide Technical Details" : "Show Technical Details"}
          </DialogButton>

          {showTechnicalDetails ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <div style={{ fontSize: "12px", opacity: 0.75 }}>Install path</div>
                <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-word" }}>
                  {game.install_path}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "12px", opacity: 0.75 }}>Required launch option</div>
                <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-word" }}>
                  {game.launch_option}
                </div>
              </div>

              <div style={{ fontSize: "12px", opacity: 0.75 }}>
                Managed files found: {game.managed_files_present}/{game.managed_files_total}
              </div>

              <div style={{ fontSize: "12px", opacity: 0.75 }}>
                Source: {game.source_name}
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <CopyLaunchOptionButton launchOption={game.launch_option} />
                <DialogButton
                  onClick={() => Navigation.NavigateToExternalWeb(game.source_url)}
                  style={{ minWidth: "180px" }}
                >
                  Open Source Page
                </DialogButton>
              </div>
            </div>
          ) : null}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function LibraryHeader(props: {
  scan: ScanResult | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { scan, loading, onRefresh } = props;

  let summary = "Run a scan to look for supported 16:10 fixes.";
  if (loading) {
    summary = "Scanning installed Steam library...";
  } else if (scan) {
    summary = `${scan.supported_games_count} supported of ${scan.installed_games_count} installed`;
  }

  return (
    <PanelSection title="Library">
      <PanelSectionRow>
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "13px", lineHeight: 1.4 }}>{summary}</div>
          <DialogButton onClick={() => void onRefresh()} disabled={loading} style={{ minWidth: "120px" }}>
            {loading ? "Scanning..." : "Rescan"}
          </DialogButton>
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function SupportedGamesList(props: {
  games: SupportedGame[];
  selectedAppId: number | null;
  onSelect: (appid: number) => void;
}) {
  const { games, selectedAppId, onSelect } = props;

  if (games.length <= 1) {
    return null;
  }

  return (
    <PanelSection title="Supported Games">
      {games.map((game) => (
        <PanelSectionRow key={game.appid}>
          <ButtonItem
            layout="below"
            description={game.status_label}
            onClick={() => onSelect(game.appid)}
          >
            {selectedAppId === game.appid ? `${game.display_title} · Selected` : game.display_title}
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}

function EmptyState() {
  return (
    <PanelSection title="No Supported Games Found">
      <PanelSectionRow>
        <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
          This plugin currently ships with curated entries for FF7 Remake, Octopath Traveler,
          and Octopath Traveler II.
          If the game is installed and the scan still shows nothing, double-check that
          Steam can see the library folder and try scanning again.
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
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [lastDebugReport, setLastDebugReport] = useState<DebugReport | null>(null);

  const refreshDebugReport = async () => {
    try {
      const report = await getLastDebugReport();
      setLastDebugReport(report);
    } catch (error) {
      console.error("Failed to load debug report:", error);
    }
  };

  const refreshScan = async () => {
    setLoading(true);
    try {
      const nextScan = await scanLibrary();
      setScan(nextScan);
      if (debugMode) {
        await refreshDebugReport();
      }

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
      if (debugMode) {
        await refreshDebugReport();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshScan();
  }, []);

  const selectedGame =
    scan?.supported_games.find((game) => game.appid === selectedAppId) ?? null;

  const handleInstall = async () => {
    if (!selectedGame) {
      return;
    }

    setBusyAppId(selectedGame.appid);
    try {
      const result = await installAutoFix(selectedGame.appid);
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
      if (debugMode) {
        await refreshDebugReport();
      }
      toaster.toast({
        title: "Install failed",
        body: debugMode
          ? `${getErrorMessage(error)} Debug report captured below.`
          : getErrorMessage(error),
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
      if (debugMode) {
        await refreshDebugReport();
      }
      toaster.toast({
        title: "Uninstall failed",
        body: debugMode
          ? `${getErrorMessage(error)} Debug report captured below.`
          : getErrorMessage(error),
      });
    } finally {
      setBusyAppId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LibraryHeader scan={scan} loading={loading} onRefresh={refreshScan} />

      <PanelSection title="Debug">
        <PanelSectionRow>
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "12px", lineHeight: 1.4 }}>
              {debugMode
                ? "Debug mode is on. If install fails, a Python traceback will appear below."
                : "Turn this on when you want a traceback on screen for troubleshooting."}
            </div>
            <DialogButton
              onClick={() => {
                const nextValue = !debugMode;
                setDebugMode(nextValue);
                if (nextValue) {
                  void refreshDebugReport();
                }
              }}
              style={{ minWidth: "140px" }}
            >
              {debugMode ? "Debug Mode On" : "Debug Mode Off"}
            </DialogButton>
          </div>
        </PanelSectionRow>
      </PanelSection>

      {scan && scan.supported_games.length === 0 ? <EmptyState /> : null}

      {scan ? (
        <SupportedGamesList
          games={scan.supported_games}
          selectedAppId={selectedAppId}
          onSelect={setSelectedAppId}
        />
      ) : null}

      {selectedGame ? (
        <DetailsSection
          game={selectedGame}
          busy={busyAppId === selectedGame.appid}
          debugMode={debugMode}
          lastDebugReport={lastDebugReport}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          showTitle={(scan?.supported_games.length ?? 0) > 1}
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
