import { useState } from "react";
import "./App.css";
import { BingoRoom } from "./components/BingoRoom";
import { HexRoom } from "./components/HexRoom";
import { LandingPage } from "./components/LandingPage";
import RandomPickTest from "./components/RandomPickTest";
import ExpressionTester from "./components/ExpressionTester";
import FontBase64Converter from "./components/FontBase64Converter";
import { useT } from "./i18n/useT";
import { langDescriptors } from "./i18n/translations";
import type { RoomConfig } from "./types";
import { useDarkMode } from "./hooks/useDarkMode";

function App() {
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null);

  const testParam = new URLSearchParams(window.location.search).get("test");
  const isTestMode =
    testParam === "randompick" ||
    testParam === "expression" ||
    testParam === "fontbase64";

  const handleJoinRoom = (config: RoomConfig) => {
    setRoomConfig(config);
  };

  const handleLeaveRoom = () => {
    setRoomConfig(null);
  };

  const { theme, toggle: toggleTheme } = useDarkMode();
  const { lang, t, setLang } = useT();

  return (
    <div id="app">
      <div className="app-toolbar">
        <a
          className="app-toolbar-btn"
          href="https://github.com/Evilnanan/bingo-kit"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        <button
          type="button"
          className="app-toolbar-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? t["toggle.light"] : t["toggle.dark"]}
        >
          {theme === "dark" ? "☼" : "☽"}
        </button>
        <select
          className="app-toolbar-select"
          value={lang}
          onChange={(e) => setLang(e.target.value as typeof lang)}
        >
          {Object.entries(langDescriptors).map(([code, desc]) => (
            <option key={code} value={code}>
              {desc.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* LandingPage stays mounted so all state (both modes) is preserved across room enter/leave */}
      <div style={{ display: roomConfig || isTestMode ? "none" : undefined }}>
        <LandingPage onJoinRoom={handleJoinRoom} />
      </div>

      {testParam === "randompick" && !roomConfig && <RandomPickTest />}
      {testParam === "expression" && !roomConfig && <ExpressionTester />}
      {testParam === "fontbase64" && !roomConfig && <FontBase64Converter />}

      {roomConfig &&
        (roomConfig.gameMode === "hex" && roomConfig.hexConfig ? (
          <HexRoom
            roomName={roomConfig.roomName}
            playerName={roomConfig.playerName}
            hexConfig={roomConfig.hexConfig}
            serverUrl={roomConfig.serverUrl}
            onLeave={handleLeaveRoom}
          />
        ) : (
          <BingoRoom
            roomName={roomConfig.roomName}
            playerName={roomConfig.playerName}
            boardConfig={roomConfig.boardConfig}
            serverUrl={roomConfig.serverUrl}
            onLeave={handleLeaveRoom}
          />
        ))}
    </div>
  );
}

export default App;
