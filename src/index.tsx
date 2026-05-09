import {
  ButtonItem,
  DialogButton,
  Navigation,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { FaCheck, FaExpandArrowsAlt } from "react-icons/fa";

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

const tokens = {
  gap: { xs: "6px", sm: "8px", md: "10px", lg: "14px" },
  radius: { sm: "8px", pill: "999px" },
  font: { xs: "11px", sm: "12px", md: "13px", lg: "16px", mono: "11px", trace: "10px" },
  pad: { pill: "4px 10px", trace: "10px" },
};

const statusStyles: Record<InstallStatus, { background: string; color: string }> = {
  managed: { background: "rgba(64, 160, 93, 0.22)", color: "#c2efcd" },
  repair: { background: "rgba(196, 143, 44, 0.22)", color: "#f6d482" },
  external: { background: "rgba(85, 135, 214, 0.22)", color: "#bcd5ff" },
  available: { background: "rgba(255, 255, 255, 0.10)", color: "#e7ebf1" },
};

function getStatusLabel(game: SupportedGame): string {
  switch (game.status) {
    case "managed":
      return game.active_profile_label ? `Installed · ${game.active_profile_label}` : "Installed";
    case "repair":
      return "Needs repair";
    case "external":
      return "Installed (manual)";
    case "available":
    default:
      return "Not installed";
  }
}

function getInstallButtonLabel(status: InstallStatus, busy: boolean): string {
  if (busy) {
    return "Installing…";
  }
  switch (status) {
    case "repair":
      return "Repair Fix";
    case "managed":
      return "Reinstall Fix";
    case "available":
    case "external":
    default:
      return "Install Fix";
  }
}

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

function StatusPill({ game }: { game: SupportedGame }) {
  const palette = statusStyles[game.status] ?? statusStyles.available;
  return (
    <div
      style={{
        background: palette.background,
        color: palette.color,
        borderRadius: tokens.radius.pill,
        padding: tokens.pad.pill,
        fontSize: tokens.font.xs,
        fontWeight: 700,
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {getStatusLabel(game)}
    </div>
  );
}

function CopyLaunchOptionButton({ game }: { game: SupportedGame }) {
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
      const copied = await copyToClipboard(game.launch_option);
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
        body: `The ${game.display_title} launch option is now on your clipboard.`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogButton
      onClick={() => void handleCopy()}
      disabled={isLoading || showSuccess}
      style={{ flex: 1, minWidth: 0 }}
    >
      {showSuccess ? "Copied" : isLoading ? "Copying…" : "Copy launch option"}
    </DialogButton>
  );
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

  if (facts.length === 0) {
    return null;
  }

  return (
    <div style={{ fontSize: tokens.font.sm, opacity: 0.8, lineHeight: 1.4 }}>
      {facts.join(" • ")}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: tokens.font.sm, opacity: 0.75, fontWeight: 700 }}>{children}</div>
  );
}

function MonoLine({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: tokens.font.mono,
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

function GameSection(props: {
  game: SupportedGame;
  busy: boolean;
  debugMode: boolean;
  lastDebugReport: DebugReport | null;
  onInstall: () => Promise<void>;
  onUninstall: () => Promise<void>;
  onToggleDebug: () => void;
}) {
  const { game, busy, debugMode, lastDebugReport, onInstall, onUninstall, onToggleDebug } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const consolidatedNotes = useMemo(() => {
    const baseNotes = [
      "Install uses your current display automatically — no need to pick a resolution.",
      ...game.install_notes,
    ];
    const knownIssues = game.known_issues.map((issue) => `Heads up: ${issue}`);
    return [...baseNotes, ...knownIssues];
  }, [game.install_notes, game.known_issues]);

  return (
    <PanelSection title={game.display_title}>
      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: tokens.gap.md }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: tokens.gap.md,
            }}
          >
            <SupportSummary game={game} />
            <StatusPill game={game} />
          </div>
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => void onInstall()}
          disabled={busy}
        >
          {getInstallButtonLabel(game.status, busy)}
        </ButtonItem>
      </PanelSectionRow>

      {game.status === "managed" || game.status === "repair" ? (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => void onUninstall()} disabled={busy}>
            {busy ? "Working…" : "Uninstall fix"}
          </ButtonItem>
        </PanelSectionRow>
      ) : null}

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: tokens.gap.sm }}>
          <SectionLabel>Notes</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5, fontSize: tokens.font.sm }}>
            {consolidatedNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: tokens.gap.md }}>
          <DialogButton onClick={() => setShowAdvanced((current) => !current)}>
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </DialogButton>

          {showAdvanced ? (
            <AdvancedDrawer
              game={game}
              debugMode={debugMode}
              lastDebugReport={lastDebugReport}
              onToggleDebug={onToggleDebug}
            />
          ) : null}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function AdvancedDrawer(props: {
  game: SupportedGame;
  debugMode: boolean;
  lastDebugReport: DebugReport | null;
  onToggleDebug: () => void;
}) {
  const { game, debugMode, lastDebugReport, onToggleDebug } = props;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap.md }}>
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap.xs }}>
        <SectionLabel>Install path</SectionLabel>
        <MonoLine>{game.install_path}</MonoLine>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap.xs }}>
        <SectionLabel>Required launch option</SectionLabel>
        <MonoLine>{game.launch_option}</MonoLine>
      </div>

      <div style={{ fontSize: tokens.font.sm, opacity: 0.75 }}>
        Managed files found: {game.managed_files_present}/{game.managed_files_total}
      </div>

      <div style={{ fontSize: tokens.font.sm, opacity: 0.75 }}>
        Source: {game.source_name}
      </div>

      <div style={{ display: "flex", gap: tokens.gap.sm }}>
        <CopyLaunchOptionButton game={game} />
        <DialogButton
          onClick={() => Navigation.NavigateToExternalWeb(game.source_url)}
          style={{ flex: 1, minWidth: 0 }}
        >
          Open source page
        </DialogButton>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: tokens.gap.sm,
          paddingTop: tokens.gap.sm,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ fontSize: tokens.font.sm, lineHeight: 1.4 }}>
          {debugMode
            ? "Debug logs are on. Tracebacks appear below."
            : "Show Python tracebacks for troubleshooting."}
        </div>
        <DialogButton onClick={onToggleDebug} style={{ minWidth: "100px" }}>
          {debugMode ? "Turn off" : "Turn on"}
        </DialogButton>
      </div>

      {debugMode && lastDebugReport ? (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap.sm }}>
          <div style={{ fontSize: tokens.font.sm, opacity: 0.75 }}>
            Captured: {lastDebugReport.captured_at} · Action: {lastDebugReport.action}
          </div>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              fontSize: tokens.font.trace,
              lineHeight: 1.4,
              background: "rgba(255,255,255,0.06)",
              borderRadius: tokens.radius.sm,
              padding: tokens.pad.trace,
              maxHeight: "320px",
              overflowY: "auto",
            }}
          >
            {lastDebugReport.traceback}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LibrarySection(props: {
  scan: ScanResult | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { scan, loading, onRefresh } = props;

  let summary: string;
  if (loading && !scan) {
    summary = "Scanning your Steam library…";
  } else if (loading) {
    summary = "Rescanning…";
  } else if (scan) {
    summary = `${scan.supported_games_count} supported · ${scan.installed_games_count} installed`;
  } else {
    summary = "Run a scan to look for supported 16:10 fixes.";
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
            gap: tokens.gap.md,
          }}
        >
          <div style={{ fontSize: tokens.font.md, lineHeight: 1.4 }}>{summary}</div>
          <DialogButton onClick={() => void onRefresh()} disabled={loading} style={{ minWidth: "100px" }}>
            {loading ? "Scanning…" : "Rescan"}
          </DialogButton>
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function GamePicker(props: {
  games: SupportedGame[];
  selectedAppId: number | null;
  onSelect: (appid: number) => void;
}) {
  const { games, selectedAppId, onSelect } = props;

  if (games.length <= 1) {
    return null;
  }

  return (
    <PanelSection title="Choose a game">
      {games.map((game) => {
        const isSelected = selectedAppId === game.appid;
        const wrapperStyle: CSSProperties = isSelected
          ? { boxShadow: "inset 3px 0 0 rgba(120,180,255,0.85)", borderRadius: tokens.radius.sm }
          : {};

        return (
          <PanelSectionRow key={game.appid}>
            <div style={wrapperStyle}>
              <ButtonItem
                layout="below"
                description={getStatusLabel(game)}
                onClick={() => onSelect(game.appid)}
                icon={isSelected ? <FaCheck /> : undefined}
              >
                {game.display_title}
              </ButtonItem>
            </div>
          </PanelSectionRow>
        );
      })}
    </PanelSection>
  );
}

function EmptyState({ catalogTitles }: { catalogTitles: string[] }) {
  const titleList = catalogTitles.length > 0 ? catalogTitles.join(", ") : "a curated set of titles";
  return (
    <PanelSection title="No supported games found">
      <PanelSectionRow>
        <div style={{ fontSize: tokens.font.sm, lineHeight: 1.5 }}>
          This plugin currently ships fixes for {titleList}. If a supported game is installed
          and the scan still shows nothing, double-check that Steam can see the library folder
          and try rescanning.
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function FirstScanState() {
  return (
    <PanelSection>
      <PanelSectionRow>
        <div style={{ fontSize: tokens.font.sm, opacity: 0.75, lineHeight: 1.5 }}>
          Looking through your installed Steam games for supported titles. This usually takes
          a couple of seconds.
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
          `Set this manually in ${selectedGame.display_title} Properties → Launch Options: ${result.launch_option}`;
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

  const handleToggleDebug = () => {
    const nextValue = !debugMode;
    setDebugMode(nextValue);
    if (nextValue) {
      void refreshDebugReport();
    }
  };

  const catalogTitles = useMemo(
    () =>
      scan?.supported_games.map((game) => game.display_title) ?? [
        "FF7 Remake Intergrade",
        "Octopath Traveler",
        "Octopath Traveler II",
        "Final Fantasy XVI",
        "Soul Hackers 2",
      ],
    [scan],
  );

  const showFirstScanState = loading && !scan;
  const showEmptyState = !showFirstScanState && scan && scan.supported_games.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LibrarySection scan={scan} loading={loading} onRefresh={refreshScan} />

      {showFirstScanState ? <FirstScanState /> : null}

      {showEmptyState ? <EmptyState catalogTitles={catalogTitles} /> : null}

      {scan ? (
        <GamePicker
          games={scan.supported_games}
          selectedAppId={selectedAppId}
          onSelect={setSelectedAppId}
        />
      ) : null}

      {selectedGame ? (
        <GameSection
          game={selectedGame}
          busy={busyAppId === selectedGame.appid}
          debugMode={debugMode}
          lastDebugReport={lastDebugReport}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onToggleDebug={handleToggleDebug}
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
