import { TEAM_COLORS } from "../utils/colors";
import { HexBoard } from "./HexBoard";
import type { HexConfig } from "../hex/hexTypes";
import { useGameState } from "../hooks/useGameState";
import { useScoring } from "../scoring/useScoring";
import { useT } from "../i18n/useT";
import { useRoomSettings } from "../hooks/useRoomSettings";
import { ChatPanel } from "./ChatPanel";
import { PlayerList } from "./PlayerList";
import { ReadyPanel } from "./ReadyPanel";
import { RoomHeader } from "./RoomHeader";
import { RoomSidebar } from "./RoomSidebar";
import { ScoringRuleCard } from "./ScoringRuleCard";
import "./RoomLayout.css";
import "./HexRoom.css";

interface Props {
  roomName: string;
  playerName: string;
  hexConfig: HexConfig;
  serverUrl: string;
  imageHost?: string;
  onLeave: () => void;
}

export function HexRoom({
  roomName,
  playerName,
  hexConfig,
  serverUrl,
  imageHost,
  onLeave,
}: Props) {
  const {
    state,
    markCell,
    changeColor,
    changeName,
    sendChat,
    toggleReady,
    leaveRoom,
    setBonusScore,
    requestRestart,
    canRestart,
  } = useGameState(roomName, playerName, hexConfig, serverUrl, "hex", onLeave);
  const { t } = useT();
  const { settings, updateSetting } = useRoomSettings();

  const players = Object.values(state.players);
  const showBoard = state.phase === "playing";
  const showLobby = state.phase === "lobby" || state.phase === "countdown";
  const isOwner =
    state.localPlayerName != null && state.localPlayerName === state.owner;

  // Fall back to the initial hexConfig prop when the server hasn't sent
  // the config yet (e.g. single-player start without countdown skips the
  // state-message broadcast). This mirrors BingoRoom's boardConfig fallback.
  const effectiveConfig = (state.config as HexConfig) || hexConfig;

  // Scoring — Hex always uses default rule.
  // Map team names ("red"/"blue") to their hex colors so PlayerList can
  // look up scores by player.color (e.g. "#dc2626") correctly.
  const hexGoals = effectiveConfig.goals;
  const metadata = state.metadata ?? effectiveConfig.metadata;
  const { scores } = useScoring(
    state.marks,
    state.players,
    hexGoals,
    undefined,
    {
      red: TEAM_COLORS.red,
      blue: TEAM_COLORS.blue,
    },
  );

  return (
    <div className="room">
      <RoomHeader
        roomName={roomName}
        serverUrl={serverUrl}
        onLeave={leaveRoom}
        extraParams={{ mode: "hex" }}
        isOwner={isOwner && canRestart}
        phase={state.phase}
        onRestart={requestRestart}
        metadata={metadata}
        imageBaseUrl={imageHost || serverUrl}
        settings={settings}
        onSettingsChange={updateSetting}
      />

      <div className="room-body">
        <div className="room-board-wrapper">
          {showLobby && (
            <ReadyPanel
              players={players}
              localPlayerName={state.localPlayerName}
              phase={state.phase}
              countdownSeconds={state.countdownSeconds}
              onToggleReady={toggleReady}
              onChangeColor={changeColor}
              onChangeName={changeName}
            />
          )}
          {showBoard &&
            (effectiveConfig ? (
              <HexBoard
                config={effectiveConfig}
                marks={state.marks}
                players={state.players}
                localPlayerName={state.localPlayerName}
                onMarkCell={markCell}
                settings={settings}
                imageBaseUrl={imageHost || serverUrl}
              />
            ) : (
              <p className="room-loading">{t["room.loading"]}</p>
            ))}
        </div>
        <RoomSidebar>
          <PlayerList
            players={players}
            scores={showBoard ? scores : undefined}
            bonusScores={state.bonusScores}
            localPlayerName={state.localPlayerName}
            onChangeColor={changeColor}
            onChangeName={changeName}
            onSetBonusScore={setBonusScore}
            allowedColors={[TEAM_COLORS.red, TEAM_COLORS.blue]}
          />
          {showBoard && <ScoringRuleCard rule={undefined} />}
          <div className="room-chat">
            <ChatPanel chats={state.chats} onSend={sendChat} />
          </div>
        </RoomSidebar>
      </div>
    </div>
  );
}
