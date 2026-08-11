import { useLayoutEffect, useRef, useState } from "react";
import { useGameState } from "../hooks/useGameState";
import { useScoring } from "../scoring/useScoring";
import { useT } from "../i18n/useT";
import { useRoomSettings } from "../hooks/useRoomSettings";
import { BingoBoard } from "./BingoBoard";
import { HexBoard } from "./HexBoard";
import { ChatPanel } from "./ChatPanel";
import { PlayerList } from "./PlayerList";
import { ReadyPanel } from "./ReadyPanel";
import { RoomHeader } from "./RoomHeader";
import { RoomSidebar } from "./RoomSidebar";
import { JoinRejectedModal } from "./JoinRejectedModal";
import { TEAM_COLORS } from "../utils/colors";
import type { BoardConfig, GameMode } from "../types";
import type { HexConfig } from "../hex/hexTypes";
import "./RoomLayout.css";

interface Props {
  roomName: string;
  playerName: string;
  boardConfig: BoardConfig;
  hexConfig?: HexConfig;
  serverUrl: string;
  imageHost?: string;
  /**
   * 主页/URL 选择的初始模式，仅在创建房间（第一个提供 config 的玩家）时生效。
   * 进入已有房间后一律以服务端 state.mode（房主设定）为准。
   */
  gameMode: GameMode;
  onLeave: () => void;
}

/**
 * 统一房间组件：根据服务端权威的 state.mode 渲染经典棋盘或 Hex 棋盘，
 * 避免加入者用自己主页的模式渲染出与房主不一致的棋盘。
 */
export function GameRoom({
  roomName,
  playerName,
  boardConfig,
  hexConfig,
  serverUrl,
  imageHost,
  gameMode,
  onLeave,
}: Props) {
  const initialConfig =
    gameMode === "hex" && hexConfig ? hexConfig : boardConfig;

  // Sidebar collapse / chat tab are lifted here so the unread-chat dot can
  // react to both, and so switching to the chat view can clear the flag.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 800px)").matches,
  );
  const [chatTab, setChatTab] = useState<"chat" | "notes">("chat");
  const chatVisibleRef = useRef(false);
  useLayoutEffect(() => {
    chatVisibleRef.current = sidebarOpen && chatTab === "chat";
  });

  const {
    state,
    markSquare,
    markCell,
    changeColor,
    changeName,
    sendChat,
    toggleReady,
    leaveRoom,
    setBonusScore,
    toggleStar,
    setCounter,
    addNote,
    updateNote,
    deleteNote,
    reorderNotes,
    requestRestart,
    canRestart,
    joinError,
    joinPending,
    retryJoin,
    changeCode,
    connectionStatus,
    stars,
    counters,
    notes,
    unreadChat,
    myCode,
    clearChatUnread,
  } = useGameState(
    roomName,
    playerName,
    initialConfig,
    serverUrl,
    gameMode,
    onLeave,
    chatVisibleRef,
  );
  const { t } = useT();
  const { settings, updateSetting } = useRoomSettings();

  const handleTabChange = (next: "chat" | "notes") => {
    setChatTab(next);
    // Looking at the chat clears the unread flag (synced to same-name
    // devices by the server). clearChatUnread no-ops when already clear.
    if (next === "chat") clearChatUnread();
  };

  const handleSidebarToggle = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    // Expanding straight into the chat view also counts as reading.
    if (next && chatTab === "chat") clearChatUnread();
  };

  const isHex = state.mode === "hex";
  const players = Object.values(state.players);
  const showBoard = state.phase === "playing";
  const showLobby = state.phase === "lobby" || state.phase === "countdown";
  const isOwner =
    state.localPlayerName != null && state.localPlayerName === state.owner;

  // Classic board data (server config wins once it arrives).
  const classicGoals =
    (state.config as BoardConfig | null)?.goals ?? boardConfig.goals;
  const lockout = (state.config as BoardConfig | null)?.lockout ?? false;

  // Hex board data: server config wins once it arrives; hexConfig is the
  // fallback for the player who created the room.
  const effectiveHexConfig =
    (state.config as HexConfig | null) ?? hexConfig ?? null;
  const hexGoals = effectiveHexConfig?.goals ?? [];

  const metadata = isHex
    ? (state.metadata ?? effectiveHexConfig?.metadata ?? null)
    : (state.metadata ?? boardConfig.metadata);

  // Scoring: Hex always uses the default rule.
  const rule = isHex
    ? undefined
    : (state.config as BoardConfig | null)?.scoringRule;

  const { scores, cellScores } = useScoring(
    state.marks,
    state.players,
    isHex ? hexGoals : classicGoals,
    rule,
    isHex ? { red: TEAM_COLORS.red, blue: TEAM_COLORS.blue } : undefined,
  );

  return (
    <div className="room">
      <RoomHeader
        roomName={roomName}
        serverUrl={serverUrl}
        onLeave={leaveRoom}
        extraParams={isHex ? { mode: "hex" } : undefined}
        isOwner={isOwner && canRestart}
        phase={state.phase}
        onRestart={requestRestart}
        metadata={metadata}
        imageBaseUrl={imageHost || serverUrl}
        settings={settings}
        onSettingsChange={updateSetting}
        myCode={myCode}
        onChangeCode={changeCode}
      />

      <div className="room-body">
        <div className="room-board-wrapper">
          {showLobby && (
            <ReadyPanel
              connecting={connectionStatus === "connecting"}
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
            (isHex ? (
              effectiveHexConfig ? (
                <HexBoard
                  config={effectiveHexConfig}
                  marks={state.marks}
                  players={state.players}
                  localPlayerName={state.localPlayerName}
                  onMarkCell={markCell}
                  stars={stars}
                  counters={counters}
                  onToggleStar={toggleStar}
                  onCounterChange={setCounter}
                  settings={settings}
                  imageBaseUrl={imageHost || serverUrl}
                />
              ) : (
                <p className="room-loading">{t["room.loading"]}</p>
              )
            ) : classicGoals.length === 25 ? (
              <BingoBoard
                goals={classicGoals}
                marks={state.marks}
                lockout={lockout}
                players={state.players}
                localPlayerName={state.localPlayerName}
                onMarkSquare={markSquare}
                stars={stars}
                counters={counters}
                onToggleStar={toggleStar}
                onCounterChange={setCounter}
                cellScores={cellScores}
                settings={settings}
                imageBaseUrl={imageHost || serverUrl}
              />
            ) : (
              <p className="room-loading">{t["room.loading"]}</p>
            ))}
        </div>
        <RoomSidebar
          open={sidebarOpen}
          onToggle={handleSidebarToggle}
          unread={unreadChat && !sidebarOpen}
        >
          <PlayerList
            players={players}
            scores={showBoard ? scores : undefined}
            bonusScores={state.bonusScores}
            localPlayerName={state.localPlayerName}
            onChangeColor={changeColor}
            onChangeName={changeName}
            onSetBonusScore={setBonusScore}
            allowedColors={
              isHex ? [TEAM_COLORS.red, TEAM_COLORS.blue] : undefined
            }
            showScoringRule={showBoard}
            rule={rule}
          />
          <div className="room-chat">
            <ChatPanel
              chats={state.chats}
              onSend={sendChat}
              notes={notes}
              onAddNote={addNote}
              onUpdateNote={updateNote}
              onDeleteNote={deleteNote}
              onReorderNotes={reorderNotes}
              tab={chatTab}
              onTabChange={handleTabChange}
              unreadChat={unreadChat}
            />
          </div>
        </RoomSidebar>
      </div>

      {joinError && (
        <JoinRejectedModal
          name={joinError.name}
          pending={joinPending}
          onJoinWithName={(name) => retryJoin(name)}
          onJoinWithCode={(code) => retryJoin(joinError.name, code)}
          onCancel={leaveRoom}
        />
      )}
    </div>
  );
}
