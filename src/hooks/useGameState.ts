import { useReducer, useLayoutEffect, useRef, useState } from "react";
import type {
  BoardConfig,
  GameState,
  GameAction,
  ServerMessage,
  MarkEntry,
  GameMode,
  GoalItem,
  PoolMetadata,
} from "../types";
import {
  stripGoalMeta,
  stripConfigImageData,
  stripAttachments,
} from "../types";
import { TEAM_COLORS } from "../utils/colors";
import type { Team } from "../utils/colors";
import {
  handleCommonAction,
  usePlayerCallbacks,
  usePartyConnection,
} from "./usePartyConnection";
import { decompressJson, compressJson } from "../utils/compressMessage";
import type { HexConfig } from "../hex/hexTypes";
import { pickGoals } from "../randomPicks";
import type PartySocket from "partysocket";

function isLockout(state: GameState): boolean {
  if (state.mode === "hex") return true;
  const cfg = state.config as BoardConfig | undefined;
  return cfg?.lockout === true;
}

function createInitialState(
  config: BoardConfig | HexConfig,
  mode: GameMode,
): GameState {
  return {
    mode,
    config,
    metadata: config.metadata ?? null,
    marks: {},
    players: {},
    localClientId: null,
    localPlayerName: null,
    chats: [],
    phase: "lobby",
    countdownSeconds: null,
    bonusScores: {},
    owner: null,
  };
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "ADD_PLAYER": {
      if (state.players[action.playerName]) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [action.playerName]: {
            name: action.playerName,
            color: action.color,
          },
        },
      };
    }

    case "ADD_MARK": {
      const existing = state.marks[action.index] || [];
      const lockout = isLockout(state);

      if (lockout) {
        // Server-authoritative: just apply the mark
        return {
          ...state,
          marks: {
            ...state.marks,
            [action.index]: [{ by: action.by, timestamp: action.timestamp }],
          },
        };
      }

      // Non-lockout: per-player marks
      const existingIdx = existing.findIndex((e) => e.by === action.by);
      if (existingIdx >= 0) {
        const updated = [...existing];
        updated[existingIdx] = { by: action.by, timestamp: action.timestamp };
        return { ...state, marks: { ...state.marks, [action.index]: updated } };
      }
      const entry: MarkEntry = { by: action.by, timestamp: action.timestamp };
      return {
        ...state,
        marks: { ...state.marks, [action.index]: [...existing, entry] },
      };
    }

    case "REMOVE_MARK": {
      const existing = state.marks[action.index] || [];
      const filtered = existing.filter((e) => e.by !== action.by);
      if (filtered.length === existing.length) return state;
      const newMarks = { ...state.marks };
      if (filtered.length === 0) {
        delete newMarks[action.index];
      } else {
        newMarks[action.index] = filtered;
      }
      return { ...state, marks: newMarks };
    }

    case "SET_CELL_MARKS": {
      // Server-authoritative cell marks.
      if (action.marks === null) {
        const newMarks = { ...state.marks };
        delete newMarks[action.index];
        return { ...state, marks: newMarks };
      }
      if (isLockout(state)) {
        // Lockout / hex: only one mark per cell. Server is fully
        // authoritative — rejected marks must not be preserved.
        return {
          ...state,
          marks: { ...state.marks, [action.index]: action.marks },
        };
      }
      // Classic (non-lockout): only preserve the LOCAL player's
      // pending marks that the server hasn't processed yet, so they
      // don't see their own optimistic marks flicker away. Marks from
      // other players were put here by the server — when the server
      // says they're gone (e.g. via unmark), they must be removed.
      const localPlayer = state.localPlayerName
        ? state.players[state.localPlayerName]
        : null;
      const localColor = localPlayer?.color ?? null;
      const serverBys = new Set(action.marks.map((e) => e.by));
      const localPending = (state.marks[action.index] || []).filter(
        (e) => e.by === localColor && !serverBys.has(e.by),
      );
      const merged = [...action.marks, ...localPending];
      return { ...state, marks: { ...state.marks, [action.index]: merged } };
    }

    case "SET_STATE": {
      // Server-authoritative state: replace config, marks, players, phase.
      // Preserve local ready if server didn't send one (server clears ready after countdown).
      const serverPlayers = action.state.players as Record<
        string,
        { name: string; color: string; ready?: boolean }
      >;
      const mergedPlayers = Object.fromEntries(
        Object.entries(serverPlayers).map(([name, serverPlayer]) => {
          const local = state.players[name];
          return [
            name,
            { ...serverPlayer, ready: serverPlayer.ready ?? local?.ready },
          ] as const;
        }),
      );
      return {
        ...state,
        ...(action.state.config !== undefined
          ? { config: action.state.config }
          : {}),
        ...(action.state.metadata !== undefined
          ? { metadata: action.state.metadata }
          : {}),
        ...(action.state.marks !== undefined
          ? { marks: action.state.marks }
          : {}),
        players: mergedPlayers,
        phase: action.state.phase ?? "playing",
        countdownSeconds: action.state.countdownSeconds ?? null,
        ...(action.state.bonusScores !== undefined
          ? { bonusScores: action.state.bonusScores }
          : {}),
        ...(action.state.owner !== undefined
          ? { owner: action.state.owner }
          : {}),
      };
    }

    case "RENAME_REJECTED": {
      // Server rejected our rename — roll back to the authoritative state.
      // players is replaced wholesale (server is authoritative) and
      // localPlayerName is corrected to what the server says we are.
      return {
        ...state,
        players: action.players,
        localPlayerName: action.yourName,
      };
    }

    case "SET_READY": {
      const player = state.players[action.playerName];
      if (!player) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [action.playerName]: { ...player, ready: action.ready },
        },
      };
    }

    case "SET_PHASE": {
      const updatedPlayers =
        action.phase === "playing"
          ? Object.fromEntries(
              Object.entries(state.players).map(([n, p]) => [
                n,
                { ...p, ready: undefined },
              ]),
            )
          : undefined;
      return {
        ...state,
        phase: action.phase,
        countdownSeconds: action.countdownSeconds ?? null,
        ...(updatedPlayers ? { players: updatedPlayers } : {}),
      };
    }

    case "SET_BONUS_SCORE": {
      return {
        ...state,
        bonusScores: {
          ...state.bonusScores,
          [action.playerName]: action.bonus,
        },
      };
    }

    case "CLEAR_SESSION":
      return {
        ...handleCommonAction(state, action),
        marks: {},
      };

    case "RENAME_PLAYER":
    case "SET_CLIENT_ID":
    case "SET_LOCAL_PLAYER_NAME":
    case "REMOVE_PLAYER":
    case "UPDATE_PLAYER_COLOR":
    case "ADD_CHAT":
      return handleCommonAction(state, action);

    default:
      return state;
  }
}

export function useGameState(
  roomName: string,
  playerName: string,
  initialConfig: BoardConfig | HexConfig,
  serverUrl: string,
  mode: GameMode,
  onLeave?: () => void,
) {
  const [state, dispatch] = useReducer(
    gameReducer,
    { config: initialConfig, mode },
    (arg) => createInitialState(arg.config, arg.mode),
  );
  const wsRef = useRef<PartySocket | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  // Keep originalPool, pickRule, and configHash client-side.
  // originalPool + pickRule are needed for re-randomization on restart.
  // configHash is sent to the server to authorize restart.
  const restartPoolRef = useRef<GoalItem[] | undefined>(
    (initialConfig as BoardConfig).originalPool,
  );
  const restartRuleRef = useRef<BoardConfig["pickRule"] | undefined>(
    (initialConfig as BoardConfig).pickRule,
  );
  const localConfigHashRef = useRef<string | undefined>(
    (initialConfig as BoardConfig | HexConfig).configHash,
  );
  // Server-authoritative configHash — stored as state so canRestart
  // re-computes when it arrives (refs can't be read during render).
  const [serverConfigHash, setServerConfigHash] = useState<string | null>(null);

  // Strip restart-only fields before sending config to server.
  function stripRestartMeta(cfg: BoardConfig): BoardConfig {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { originalPool, pickRule, ...rest } = cfg;
    return rest;
  }

  // Handle messages from the PartyKit server
  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "state": {
        // Server compresses config to base64 — decompress if needed
        let cfg: unknown = msg.config;
        if (typeof cfg === "string") {
          const decompressed = decompressJson<BoardConfig | HexConfig>(cfg);
          if (decompressed !== null) cfg = decompressed;
        }
        // Merge local originalPool/pickRule into the server config (they're
        // never sent to the server — only kept client-side for restart).
        if (cfg != null && mode === "classic" && restartPoolRef.current) {
          (cfg as BoardConfig).originalPool = restartPoolRef.current;
          (cfg as BoardConfig).pickRule = restartRuleRef.current;
        }
        // Track the server-authoritative configHash for canRestart check.
        const scHash = (msg as { configHash?: string | null }).configHash;
        if (scHash !== undefined) {
          setServerConfigHash(scHash);
        }
        dispatch({
          type: "SET_STATE",
          state: {
            config: cfg as BoardConfig | HexConfig | undefined,
            metadata: msg.metadata ?? null,
            marks: msg.marks as Record<number, MarkEntry[]>,
            players: msg.players,
            phase: msg.phase,
            countdownSeconds: msg.countdownSeconds ?? undefined,
            bonusScores: (msg as { bonusScores?: Record<string, number> })
              .bonusScores,
            owner: (msg as { owner?: string | null }).owner,
          },
        });
        break;
      }

      case "player_joined": {
        dispatch({
          type: "ADD_PLAYER",
          playerName: msg.name,
          color: msg.color,
        });
        break;
      }

      case "player_left": {
        dispatch({ type: "REMOVE_PLAYER", playerName: msg.name });
        break;
      }

      case "rename_rejected": {
        dispatch({
          type: "RENAME_REJECTED",
          yourName: msg.yourName,
          players: msg.players,
        });
        break;
      }

      case "mark": {
        // Server sends full marks array with authoritative chronological order
        dispatch({
          type: "SET_CELL_MARKS",
          index: msg.index,
          marks: msg.marks,
        });
        break;
      }

      case "unmark": {
        // Server sends full marks array (or null if cell is now empty)
        dispatch({
          type: "SET_CELL_MARKS",
          index: msg.index,
          marks: msg.marks,
        });
        break;
      }

      case "change_color": {
        dispatch({
          type: "UPDATE_PLAYER_COLOR",
          playerName: msg.name,
          color: msg.color,
        });
        break;
      }

      case "rename": {
        dispatch({
          type: "RENAME_PLAYER",
          oldName: msg.oldName,
          newName: msg.newName,
        });
        break;
      }

      case "chat": {
        dispatch({
          type: "ADD_CHAT",
          msg: {
            name: msg.name,
            color: msg.color,
            text: msg.text,
            timestamp: Date.now(),
          },
        });
        break;
      }

      case "ready": {
        dispatch({ type: "SET_READY", playerName: msg.name, ready: msg.ready });
        break;
      }

      case "start": {
        dispatch({ type: "SET_PHASE", phase: "playing" });
        break;
      }

      case "bonus_score": {
        dispatch({
          type: "SET_BONUS_SCORE",
          playerName: msg.playerName,
          bonus: msg.bonus,
        });
        break;
      }
    }
  }

  // Connect to PartyKit server
  // Strip originalPool/pickRule from config — they're only needed client-side for restart.
  // Strip image base64 data — keep only hashes for wire transmission.
  const lockout = (initialConfig as BoardConfig).lockout === true;
  const wireConfig = stripConfigImageData(
    mode === "classic"
      ? stripRestartMeta(initialConfig as BoardConfig)
      : initialConfig,
  );
  // Pool metadata is sent separately at join so it can be shared in the
  // lobby — the board config (goals) is only broadcast when the game starts.
  const initialMeta = (initialConfig as BoardConfig | HexConfig).metadata;
  const wireMetadata: PoolMetadata | undefined = initialMeta
    ? {
        ...initialMeta,
        ...(initialMeta.images && initialMeta.images.length > 0
          ? { images: stripAttachments(initialMeta.images) }
          : {}),
      }
    : undefined;
  usePartyConnection({
    serverUrl,
    roomName,
    playerName,
    config: wireConfig,
    metadata: wireMetadata,
    mode,
    lockout,
    dispatch,
    wsRef,
    onMessage: handleServerMessage,
  });

  // Note: the "start" message from the server is the sole authority for
  // transitioning to "playing". The countdownSeconds field from "state"
  // is purely for UI — ReadyPanel uses it to display "3, 2, 1".

  function requestRestart() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;

    const pool = restartPoolRef.current;
    const rule = restartRuleRef.current;
    let newConfig: unknown = undefined;

    // For classic mode with originalPool + pickRule, re-randomize goals
    if (current.mode === "classic" && pool && rule) {
      const newGoals = pickGoals(pool, rule).slice(0, 25);
      const cfg = current.config as BoardConfig | undefined;
      const newBoardConfig: BoardConfig = {
        ...(cfg ?? { goals: [] }),
        goals: stripGoalMeta(newGoals),
      };
      // Strip image data — keep only hashes for wire
      newConfig = compressJson(stripConfigImageData(newBoardConfig));
    }

    ws.send(
      JSON.stringify({
        type: "restart",
        config: newConfig,
        configHash: localConfigHashRef.current,
      }),
    );
  }

  function leaveRoom() {
    onLeave?.();
  }

  function toggleReady() {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;

    const current = stateRef.current;
    if (current.phase !== "lobby") return;

    const currentPlayer = current.players[myName];
    if (!currentPlayer) return;

    const newReady = !currentPlayer.ready;

    ws.send(JSON.stringify({ type: "ready", name: myName, ready: newReady }));
    dispatch({ type: "SET_READY", playerName: myName, ready: newReady });
  }

  function markSquare(index: number) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;

    const current = stateRef.current;

    if (current.mode === "hex") {
      const myPlayer = current.players[myName];
      if (!myPlayer) return;

      const myTeam: Team = myPlayer.color === TEAM_COLORS.red ? "red" : "blue";
      const existingEntry = current.marks[index]?.[0];

      if (existingEntry) {
        if (existingEntry.by === myTeam) {
          ws.send(JSON.stringify({ type: "unmark", index, by: myTeam }));
          dispatch({ type: "REMOVE_MARK", index, by: myTeam });
        }
      } else {
        ws.send(JSON.stringify({ type: "mark", index, by: myTeam }));
        dispatch({
          type: "ADD_MARK",
          index,
          by: myTeam,
          timestamp: Date.now(),
        });
      }
      return;
    }

    // Classic mode
    const myPlayer = current.players[myName];
    if (!myPlayer) return;

    const lockout = isLockout(current);
    if (lockout) {
      const existingEntry = current.marks[index]?.[0];
      if (existingEntry && existingEntry.by !== myPlayer.color) return;
    }

    const isMarked =
      current.marks[index]?.some((e) => e.by === myPlayer.color) ?? false;

    if (isMarked) {
      ws.send(JSON.stringify({ type: "unmark", index, by: myPlayer.color }));
      dispatch({ type: "REMOVE_MARK", index, by: myPlayer.color });
    } else {
      ws.send(JSON.stringify({ type: "mark", index, by: myPlayer.color }));
      dispatch({
        type: "ADD_MARK",
        index,
        by: myPlayer.color,
        timestamp: Date.now(),
      });
    }
  }

  function markCell(index: number) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;

    const current = stateRef.current;
    const myPlayer = current.players[myName];
    if (!myPlayer) return;

    const myTeam: Team = myPlayer.color === TEAM_COLORS.red ? "red" : "blue";
    const existingEntry = current.marks[index]?.[0];

    if (existingEntry) {
      if (existingEntry.by === myTeam) {
        ws.send(JSON.stringify({ type: "unmark", index, by: myTeam }));
        dispatch({ type: "REMOVE_MARK", index, by: myTeam });
      }
    } else {
      ws.send(JSON.stringify({ type: "mark", index, by: myTeam }));
      dispatch({ type: "ADD_MARK", index, by: myTeam, timestamp: Date.now() });
    }
  }

  const { changeColor, changeName, sendChat } = usePlayerCallbacks(
    wsRef,
    stateRef,
    dispatch,
  );

  function setBonusScore(playerName: string, bonus: number) {
    const ws = wsRef.current;
    if (!ws) return;
    ws.send(JSON.stringify({ type: "bonus_score", playerName, bonus }));
    dispatch({ type: "SET_BONUS_SCORE", playerName, bonus });
  }

  // Only allow restart if this device's config hash matches the server's.
  const localHash = (initialConfig as BoardConfig | HexConfig).configHash;
  const canRestart = (() => {
    if (!localHash) return false;
    if (!serverConfigHash) return true; // haven't received server state yet — allow optimistically
    return localHash === serverConfigHash;
  })();

  return {
    state,
    markSquare,
    markCell,
    changeColor,
    changeName,
    sendChat,
    toggleReady,
    leaveRoom,
    setBonusScore,
    requestRestart,
    canRestart,
  };
}
