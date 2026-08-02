import { useGameState } from "../hooks/useGameState";
import { useScoring } from "../scoring/useScoring";
import { useT } from "../i18n/useT";
import { useRoomSettings } from "../hooks/useRoomSettings";
import { BingoBoard } from "./BingoBoard";
import { ChatPanel } from "./ChatPanel";
import { PlayerList } from "./PlayerList";
import { ReadyPanel } from "./ReadyPanel";
import { RoomHeader } from "./RoomHeader";
import { RoomSidebar } from "./RoomSidebar";
import { ScoringRuleCard } from "./ScoringRuleCard";
import "./RoomLayout.css";
import "./BingoRoom.css";

interface Props {
  roomName: string;
  playerName: string;
  boardConfig: import("../types").BoardConfig;
  serverUrl: string;
  imageHost?: string;
  onLeave: () => void;
}

export function BingoRoom({
  roomName,
  playerName,
  boardConfig,
  serverUrl,
  imageHost,
  onLeave,
}: Props) {
  const {
    state,
    markSquare,
    changeColor,
    changeName,
    sendChat,
    toggleReady,
    leaveRoom,
    setBonusScore,
    requestRestart,
    canRestart,
  } = useGameState(
    roomName,
    playerName,
    boardConfig,
    serverUrl,
    "classic",
    onLeave,
  );
  const { t } = useT();
  const { settings, updateSetting } = useRoomSettings();

  const goals = state.config?.goals || boardConfig.goals;
  const lockout =
    (state.config as import("../types").BoardConfig)?.lockout ?? false;
  const metadata = state.metadata ?? boardConfig.metadata;

  const players = Object.values(state.players);
  const showBoard = state.phase === "playing";
  const showLobby = state.phase === "lobby" || state.phase === "countdown";
  const isOwner =
    state.localPlayerName != null && state.localPlayerName === state.owner;

  // Scoring
  const rule = (state.config as import("../types").BoardConfig)?.scoringRule;
  const { scores, cellScores } = useScoring(
    state.marks,
    state.players,
    goals,
    rule,
  );

  return (
    <div className="room">
      <RoomHeader
        roomName={roomName}
        serverUrl={serverUrl}
        onLeave={leaveRoom}
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
            (goals.length === 25 ? (
              <BingoBoard
                goals={goals}
                marks={state.marks}
                lockout={lockout}
                players={state.players}
                localPlayerName={state.localPlayerName}
                onMarkSquare={markSquare}
                cellScores={cellScores}
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
          />
          {showBoard && <ScoringRuleCard rule={rule} />}
          <div className="room-chat">
            <ChatPanel chats={state.chats} onSend={sendChat} />
          </div>
        </RoomSidebar>
      </div>
    </div>
  );
}
