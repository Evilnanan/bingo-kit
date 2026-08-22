import {
  useReducer,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
} from "react";
import type {
  BoardConfig,
  GameState,
  GameAction,
  ServerMessage,
  MarkEntry,
  PlayerNote,
  ChatMessage,
  GameMode,
  GoalItem,
  PoolMetadata,
  RoomTimer,
  RoomTimerState,
} from "../types";
import {
  stripGoalMeta,
  stripConfigImageData,
  stripAttachments,
  createEmptyTimerState,
} from "../types";
import { TEAM_COLORS } from "../utils/colors";
import type { Team } from "../utils/colors";
import { recordOneWaySample } from "../utils/serverClock";
import {
  handleCommonAction,
  usePlayerCallbacks,
  usePartyConnection,
} from "./usePartyConnection";
import { decompressJson, compressJson } from "../utils/compressMessage";
import type { HexConfig } from "../hex/hexTypes";
import { pickHexGoals } from "../hex/hexPick";
import { pickGoals } from "../randomPicks";
import { PoolPickError } from "../randomPicks/errors";
import { useT } from "../i18n/useT";
import type PartySocket from "partysocket";
import { savePlayerCode, renamePlayerCode } from "../utils/playerCodeStorage";

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
    connection: "connecting",
    metadata: config.metadata ?? null,
    marks: {},
    stars: new Set<number>(),
    counters: {},
    notes: [],
    unreadChat: false,
    myCode: null,
    players: {},
    localClientId: null,
    localPlayerName: null,
    chats: [],
    phase: "lobby",
    countdownSeconds: null,
    bonusScores: {},
    owner: null,
    timer: createEmptyTimerState(),
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
        ...(action.state.mode !== undefined ? { mode: action.state.mode } : {}),
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
        ...(action.state.stars !== undefined
          ? { stars: new Set(action.state.stars) }
          : {}),
        ...(action.state.counters !== undefined
          ? { counters: action.state.counters }
          : {}),
        ...(action.state.notes !== undefined
          ? { notes: action.state.notes }
          : {}),
        ...(action.state.unreadChat !== undefined
          ? { unreadChat: action.state.unreadChat }
          : {}),
        ...(action.state.timer !== undefined
          ? { timer: action.state.timer }
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

    case "APPLY_STAR": {
      const next = new Set(state.stars);
      if (action.starred) next.add(action.index);
      else next.delete(action.index);
      return { ...state, stars: next };
    }

    case "APPLY_COUNTER": {
      const next = { ...state.counters };
      if (action.value > 0) next[action.index] = action.value;
      else delete next[action.index];
      return { ...state, counters: next };
    }

    case "APPLY_CHAT_UNREAD":
      return { ...state, unreadChat: action.unread };

    case "ADD_NOTE": {
      return { ...state, notes: [...state.notes, action.note] };
    }

    case "UPDATE_NOTE": {
      return {
        ...state,
        notes: state.notes.map((n) => (n.id === action.id ? action.note : n)),
      };
    }

    case "DELETE_NOTE": {
      return {
        ...state,
        notes: state.notes.filter((n) => n.id !== action.id),
      };
    }

    case "REORDER_NOTES": {
      const byId = new Map(state.notes.map((n) => [n.id, n]));
      const next = action.ids
        .map((id) => byId.get(id))
        .filter((n): n is PlayerNote => n !== undefined);
      return { ...state, notes: next };
    }

    case "SET_TIMER": {
      // Server-authoritative room timer state (queue + run).
      return { ...state, timer: action.timer };
    }

    case "CLEAR_SESSION":
      return {
        ...handleCommonAction(state, action),
        connection: "connecting",
        marks: {},
        stars: new Set<number>(),
        counters: {},
        notes: [],
        unreadChat: false,
        myCode: null,
        timer: createEmptyTimerState(),
      };

    case "SET_MY_CODE":
      return { ...state, myCode: action.code };

    case "SET_CONNECTED":
      return { ...state, connection: "connected" };

    case "SET_CHATS":
      // Authoritative history from the server: replace the local list so a
      // reconnecting client never ends up with duplicates or gaps.
      return { ...state, chats: action.chats };

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
  chatVisibleRef?: React.RefObject<boolean>,
) {
  const [state, dispatch] = useReducer(
    gameReducer,
    { config: initialConfig, mode },
    (arg) => createInitialState(arg.config, arg.mode),
  );
  const { t } = useT();
  const wsRef = useRef<PartySocket | null>(null);
  const stateRef = useRef(state);
  /** Imperative re-join (used after a join rejection). */
  const sendJoinRef = useRef<((name: string, code?: string) => void) | null>(
    null,
  );
  /** Latest authoritative local name, kept current for the leave-on-pagehide message. */
  const localPlayerNameRef = useRef<string | null>(null);
  /** Set when the server rejects our join: the name is taken and the
   *  identity code is missing or wrong (treated as the same error). */
  const [joinError, setJoinError] = useState<{ name: string } | null>(null);
  /**
   * Which retry path is currently awaiting the server's answer. Kept separate
   * from `joinError` so the dialog stays mounted (and shows a spinner) while
   * the join attempt is in flight.
   */
  const [joinPending, setJoinPending] = useState<"code" | "name" | null>(null);
  /**
   * Name of the player the owner tried to remove but couldn't, because that
   * player still has a live connection. Drives a short transient notice.
   */
  const [kickNotice, setKickNotice] = useState<string | null>(null);
  /** Last chat message seen by this client — baseline for the unread dot. */
  const lastChatRef = useRef<ChatMessage | null>(null);
  useEffect(() => {
    if (!kickNotice) return;
    const id = window.setTimeout(() => setKickNotice(null), 3000);
    return () => window.clearTimeout(id);
  }, [kickNotice]);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    localPlayerNameRef.current = state.localPlayerName;
  }, [state.localPlayerName]);

  // Keep originalPool, pickRule, and configHash client-side.
  // originalPool + pickRule are needed for re-randomization on restart.
  // configHash is sent to the server to authorize restart.
  const restartPoolRef = useRef<GoalItem[] | undefined>(
    (initialConfig as BoardConfig).originalPool ??
      (initialConfig as HexConfig).originalPool,
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

  // Strip restart-only fields before sending config to server (classic:
  // originalPool/pickRule; hex: originalPool).
  function stripRestartMeta(cfg: unknown): unknown {
    if (!cfg || typeof cfg !== "object") return cfg;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { originalPool, pickRule, ...rest } = cfg as Record<string, unknown>;
    return rest;
  }

  // Handle messages from the PartyServer
  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "state": {
        // The server has acknowledged us with authoritative room state.
        dispatch({ type: "SET_CONNECTED" });
        setJoinError(null);
        setJoinPending(null);
        // The state message is stamped with the server clock — use it to
        // seed/refine the offset estimate for the shared room timer.
        const stateServerTime = (msg as { serverTime?: number }).serverTime;
        if (typeof stateServerTime === "number") {
          recordOneWaySample(stateServerTime, Date.now());
        }
        // The server knows the authoritative name for this connection (it may
        // differ from the homepage name after a retry join).
        const myName = (msg as { myName?: string }).myName;
        if (myName) {
          dispatch({ type: "SET_LOCAL_PLAYER_NAME", name: myName });
        }
        // Server compresses config to base64 — decompress if needed
        let cfg: unknown = msg.config;
        if (typeof cfg === "string") {
          const decompressed = decompressJson<BoardConfig | HexConfig>(cfg);
          if (decompressed !== null) cfg = decompressed;
        }
        // Merge local originalPool/pickRule into the server config (they're
        // never sent to the server — only kept client-side for restart).
        // Use the server-authoritative mode, not the local homepage mode.
        const effectiveMode = msg.mode ?? mode;
        if (cfg != null && restartPoolRef.current) {
          if (effectiveMode === "classic") {
            (cfg as BoardConfig).originalPool = restartPoolRef.current;
            (cfg as BoardConfig).pickRule = restartRuleRef.current;
          } else if (effectiveMode === "hex") {
            (cfg as HexConfig).originalPool = restartPoolRef.current;
          }
        }
        // Track the server-authoritative configHash for canRestart check.
        const scHash = (msg as { configHash?: string | null }).configHash;
        if (scHash !== undefined) {
          setServerConfigHash(scHash);
        }
        // Normalize the timer state (a state message from an older server
        // build may lack the autoStart field).
        const serverTimer = (msg as { timer?: RoomTimerState }).timer;
        const normalizedTimer: RoomTimerState | undefined = serverTimer
          ? { ...serverTimer, autoStart: serverTimer.autoStart === true }
          : undefined;
        dispatch({
          type: "SET_STATE",
          state: {
            config: cfg as BoardConfig | HexConfig | undefined,
            mode: effectiveMode,
            metadata: msg.metadata ?? null,
            marks: msg.marks as Record<number, MarkEntry[]>,
            players: msg.players,
            phase: msg.phase,
            countdownSeconds: msg.countdownSeconds ?? undefined,
            bonusScores: (msg as { bonusScores?: Record<string, number> })
              .bonusScores,
            owner: (msg as { owner?: string | null }).owner,
            stars: (msg as { myStars?: number[] }).myStars,
            counters: (msg as { myCounters?: Record<number, number> })
              .myCounters,
            notes: (msg as { myNotes?: PlayerNote[] }).myNotes,
            unreadChat: (msg as { myUnreadChat?: boolean }).myUnreadChat,
            timer: normalizedTimer,
          },
        });
        // Cache the server-assigned identity code locally so a reload or a
        // socket reconnect can re-join the same name without re-entering it.
        const myCode = (msg as { myCode?: string | null }).myCode;
        if (myCode !== undefined) {
          dispatch({ type: "SET_MY_CODE", code: myCode ?? null });
          if (myCode) {
            savePlayerCode(
              roomName,
              myName ?? stateRef.current.localPlayerName ?? playerName,
              myCode,
            );
          }
        }
        break;
      }

      case "join_rejected": {
        // The name is taken and no matching identity code was provided.
        // Show the modal that offers to rename or join as the same player
        // with the correct code. Missing and wrong codes are the same error.
        setJoinPending(null);
        setJoinError({ name: msg.name });
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

      case "kick_rejected": {
        // The target still has a live connection, so removal was invalid.
        // Show the owner a short notice naming the player.
        setKickNotice(msg.name);
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
        // The identity code belongs to the player, so it follows renames in
        // the local cache too.
        renamePlayerCode(roomName, msg.oldName, msg.newName);
        dispatch({
          type: "RENAME_PLAYER",
          oldName: msg.oldName,
          newName: msg.newName,
        });
        break;
      }

      case "code_changed": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "SET_MY_CODE", code: msg.code });
        savePlayerCode(roomName, msg.name, msg.code);
        break;
      }

      case "chat": {
        dispatch({
          type: "ADD_CHAT",
          msg: {
            name: msg.name,
            color: msg.color,
            text: msg.text,
            timestamp: msg.timestamp ?? Date.now(),
          },
        });
        break;
      }

      case "chat_history": {
        // Full server-side history: replace the local list so no message is
        // missing or duplicated. The last history entry becomes the unread
        // baseline — only live messages that arrive after this point can
        // light the unread dot.
        lastChatRef.current = msg.chats[msg.chats.length - 1] ?? null;
        dispatch({ type: "SET_CHATS", chats: msg.chats });
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

      case "star": {
        // Server already routes to same-name clients only; guard anyway.
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({
          type: "APPLY_STAR",
          index: msg.index,
          starred: msg.starred,
        });
        break;
      }

      case "counter": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "APPLY_COUNTER", index: msg.index, value: msg.value });
        break;
      }

      case "chat_unread": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "APPLY_CHAT_UNREAD", unread: msg.unread });
        break;
      }

      case "note_added": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "ADD_NOTE", note: msg.note });
        break;
      }

      case "note_updated": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "UPDATE_NOTE", id: msg.note.id, note: msg.note });
        break;
      }

      case "note_deleted": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "DELETE_NOTE", id: msg.id });
        break;
      }

      case "notes_reordered": {
        if (msg.name !== stateRef.current.localPlayerName) break;
        dispatch({ type: "REORDER_NOTES", ids: msg.ids });
        break;
      }

      case "timer_state": {
        // Fresh authoritative room-timer state, stamped with the server
        // clock — re-estimate the offset right when the timer changes so
        // every player's display stays aligned.
        recordOneWaySample(msg.serverTime, Date.now());
        dispatch({
          type: "SET_TIMER",
          timer: {
            timers: msg.timers,
            currentIndex: msg.currentIndex,
            status: msg.status,
            endAt: msg.endAt,
            startedAt: msg.startedAt,
            pausedRemaining: msg.pausedRemaining,
            pausedElapsed: msg.pausedElapsed,
            autoStart: msg.autoStart === true,
          },
        });
        break;
      }
    }
  }

  // Connect to PartyServer
  // Strip originalPool/pickRule from config — they're only needed client-side for restart.
  // Strip image base64 data — keep only hashes for wire transmission.
  const lockout = (initialConfig as BoardConfig).lockout === true;
  const wireConfig = stripConfigImageData(stripRestartMeta(initialConfig));
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
    sendJoinRef,
    localPlayerNameRef,
  });

  // Note: the "start" message from the server is the sole authority for
  // transitioning to "playing". The countdownSeconds field from "state"
  // is purely for UI — ReadyPanel uses it to display "3, 2, 1".

  // Unread-chat indicator: when a new chat arrives while the chat view isn't
  // visible (notes tab or collapsed sidebar), flag it and sync the flag to
  // same-name devices via the server. Messages the local player sent are
  // ignored (only "other people" count).
  useEffect(() => {
    const latest = state.chats[state.chats.length - 1] ?? null;
    if (!latest) {
      lastChatRef.current = null;
      return;
    }
    if (latest === lastChatRef.current) return;
    lastChatRef.current = latest;
    if (latest.name !== state.localPlayerName && !chatVisibleRef?.current) {
      markChatUnread();
    }
    // chatVisibleRef is a stable ref provided by the caller; including it in
    // the deps would re-run the effect every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chats, state.localPlayerName]);

  function requestRestart() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;

    const pool = restartPoolRef.current;
    const rule = restartRuleRef.current;
    let newConfig: unknown = undefined;

    // For classic mode with originalPool + pickRule, re-randomize goals
    if (current.mode === "classic" && pool && rule) {
      let newGoals: GoalItem[];
      try {
        newGoals = pickGoals(pool, rule).slice(0, 25);
      } catch (err) {
        // Pool too small — show the generic message.
        if (err instanceof PoolPickError) {
          alert(t["landing.notEnoughGoals"]);
          return;
        }
        throw err;
      }
      const cfg = current.config as BoardConfig | undefined;
      const newBoardConfig: BoardConfig = {
        ...(cfg ?? { goals: [] }),
        goals: stripGoalMeta(newGoals),
      };
      // Strip image data + restart-only fields — keep only hashes for wire
      newConfig = compressJson(
        stripConfigImageData(stripRestartMeta(newBoardConfig)),
      );
    }

    // Hex mode: re-pick goals from the original pool (same algorithm as
    // room creation) so a restart produces a fresh board.
    if (current.mode === "hex" && pool) {
      const cfg = current.config as HexConfig | undefined;
      const sizeBlue = cfg?.sizeBlue ?? (initialConfig as HexConfig).sizeBlue;
      const sizeRed = cfg?.sizeRed ?? (initialConfig as HexConfig).sizeRed;
      const newHexConfig: HexConfig = {
        sizeBlue,
        sizeRed,
        goals: stripGoalMeta(pickHexGoals(pool, sizeBlue * sizeRed)),
        ...(cfg?.metadata ? { metadata: cfg.metadata } : {}),
      };
      // Strip image data + restart-only fields — keep only hashes for wire
      newConfig = compressJson(
        stripConfigImageData(stripRestartMeta(newHexConfig)),
      );
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
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (ws && myName) {
      // Notify the server this is an active exit so it removes us right away.
      // Passive disconnects (background tab drops) get a grace period instead.
      ws.send(JSON.stringify({ type: "leave", name: myName }));
    }
    onLeave?.();
  }

  /**
   * Room owner: request removal of a player. The server only honors this for
   * a fully disconnected player; if the target has any live connection, the
   * request is rejected and a short notice is shown instead.
   */
  function kickPlayer(targetName: string) {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || !current.localPlayerName) return;
    if (current.localPlayerName !== current.owner) return;
    ws.send(JSON.stringify({ type: "kick", name: targetName }));
  }

  /**
   * Re-attempt joining after the server rejected the original join (name
   * already taken). Pass a different name to join as a new player, or the
   * same name plus the correct identity code to join as the same player on
   * another device.
   */
  function retryJoin(name: string, code?: string) {
    // Keep the dialog open and mark the submitted path as pending: the modal
    // must not unmount while the server verifies the code/name, otherwise the
    // input and error state get wiped.
    setJoinPending(code ? "code" : "name");
    dispatch({ type: "SET_LOCAL_PLAYER_NAME", name });
    sendJoinRef.current?.(name, code);
  }

  /** Change this player's identity code (any non-empty string, max 32 chars). */
  function changeCode(code: string) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    const trimmed = code.trim();
    if (!ws || !myName || !trimmed || trimmed.length > 32) return;
    ws.send(
      JSON.stringify({ type: "change_code", name: myName, code: trimmed }),
    );
    dispatch({ type: "SET_MY_CODE", code: trimmed });
    savePlayerCode(roomName, myName, trimmed);
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

  /** Number of cells on the current board (used to bound todo-linked indices). */
  function boardCellCount(): number {
    const current = stateRef.current;
    if (current.mode === "hex") {
      const cfg = current.config as HexConfig | null;
      const sizeBlue = cfg?.sizeBlue ?? (initialConfig as HexConfig).sizeBlue;
      const sizeRed = cfg?.sizeRed ?? (initialConfig as HexConfig).sizeRed;
      return sizeBlue * sizeRed;
    }
    const cfg = current.config as BoardConfig | null;
    return cfg?.goals?.length ?? 25;
  }

  /**
   * Todo-linked cell trigger: explicitly mark (lit) or unmark a cell for the
   * local player, mirroring the guards used by manual board clicks. No-op
   * unless the game is actually playing, so a lobby check never lights cells.
   */
  function applyTodoLight(index: number, lit: boolean) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!ws || !myName) return;
    const current = stateRef.current;
    if (current.phase !== "playing") return;
    if (!Number.isInteger(index) || index < 0 || index >= boardCellCount())
      return;
    const myPlayer = current.players[myName];
    if (!myPlayer) return;

    if (current.mode === "hex") {
      const myTeam: Team = myPlayer.color === TEAM_COLORS.red ? "red" : "blue";
      const existingEntry = current.marks[index]?.[0];
      if (lit) {
        // Hex is lockout-style: a cell owned by anyone (including us) is done.
        if (existingEntry) return;
        ws.send(JSON.stringify({ type: "mark", index, by: myTeam }));
        dispatch({
          type: "ADD_MARK",
          index,
          by: myTeam,
          timestamp: Date.now(),
        });
      } else {
        if (!existingEntry || existingEntry.by !== myTeam) return;
        ws.send(JSON.stringify({ type: "unmark", index, by: myTeam }));
        dispatch({ type: "REMOVE_MARK", index, by: myTeam });
      }
      return;
    }

    // Classic mode
    const myColor = myPlayer.color;
    if (lit) {
      if (isLockout(current)) {
        // Lockout: only unclaimed cells can be lit by the todo.
        if (current.marks[index]?.[0]) return;
      } else {
        const isMarked =
          current.marks[index]?.some((e) => e.by === myColor) ?? false;
        if (isMarked) return;
      }
      ws.send(JSON.stringify({ type: "mark", index, by: myColor }));
      dispatch({ type: "ADD_MARK", index, by: myColor, timestamp: Date.now() });
    } else {
      const isMarked =
        current.marks[index]?.some((e) => e.by === myColor) ?? false;
      if (!isMarked) return;
      ws.send(JSON.stringify({ type: "unmark", index, by: myColor }));
      dispatch({ type: "REMOVE_MARK", index, by: myColor });
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

  function toggleStar(index: number, starred: boolean) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    ws.send(
      JSON.stringify({ type: "toggle_star", name: myName, index, starred }),
    );
    dispatch({ type: "APPLY_STAR", index, starred });
  }

  function setCounter(index: number, value: number) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    ws.send(
      JSON.stringify({ type: "set_counter", name: myName, index, value }),
    );
    dispatch({ type: "APPLY_COUNTER", index, value });
  }

  function markChatUnread() {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    if (stateRef.current.unreadChat) return;
    ws.send(
      JSON.stringify({ type: "set_chat_unread", name: myName, unread: true }),
    );
    dispatch({ type: "APPLY_CHAT_UNREAD", unread: true });
  }

  function clearChatUnread() {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    if (!stateRef.current.unreadChat) return;
    ws.send(
      JSON.stringify({ type: "set_chat_unread", name: myName, unread: false }),
    );
    dispatch({ type: "APPLY_CHAT_UNREAD", unread: false });
  }

  function addNote(text: string, todo: boolean) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note: PlayerNote = { id, text, todo, done: false };
    ws.send(JSON.stringify({ type: "add_note", name: myName, note }));
    dispatch({ type: "ADD_NOTE", note });
  }

  function updateNote(
    id: string,
    patch: {
      text?: string;
      todo?: boolean;
      done?: boolean;
      linkedCells?: number[] | null;
    },
  ) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    const current = stateRef.current.notes.find((n) => n.id === id);
    if (!current) return;
    const note: PlayerNote = {
      ...current,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.todo !== undefined ? { todo: patch.todo } : {}),
      ...(patch.done !== undefined ? { done: patch.done } : {}),
      // Normalize null (clear link) to an absent property locally.
      ...(patch.linkedCells !== undefined
        ? { linkedCells: patch.linkedCells ?? undefined }
        : {}),
    };
    ws.send(
      JSON.stringify({ type: "update_note", name: myName, id, ...patch }),
    );
    dispatch({ type: "UPDATE_NOTE", id, note });
    // The todo is a pure trigger: only toggling "done" touches the board.
    if (patch.done !== undefined && patch.done !== current.done) {
      const cells = current.linkedCells ?? [];
      for (const index of cells) {
        applyTodoLight(index, patch.done);
      }
    }
  }

  function deleteNote(id: string) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    ws.send(JSON.stringify({ type: "delete_note", name: myName, id }));
    dispatch({ type: "DELETE_NOTE", id });
  }

  function reorderNotes(ids: string[]) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    ws.send(JSON.stringify({ type: "reorder_notes", name: myName, ids }));
    dispatch({ type: "REORDER_NOTES", ids });
  }

  /** Room owner: replace the serial timer queue. An optional auto-start flag
   *  travels with the submit (runs the queue when the game starts). */
  function submitTimers(timers: RoomTimer[], autoStart?: boolean) {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;
    ws.send(
      JSON.stringify({
        type: "timer_submit",
        timers,
        ...(typeof autoStart === "boolean" ? { autoStart } : {}),
      }),
    );
  }

  /** Room owner: start the run (or resume when paused). */
  function timerStart() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;
    ws.send(JSON.stringify({ type: "timer_start" }));
  }

  /** Room owner: pause the running timer. */
  function timerPause() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;
    ws.send(JSON.stringify({ type: "timer_pause" }));
  }

  /** Room owner: end the current timer now; the next one starts automatically. */
  function timerStop() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;
    ws.send(JSON.stringify({ type: "timer_stop" }));
  }

  /** Room owner: skip the current timer and start the next one. */
  function timerNext() {
    const ws = wsRef.current;
    const current = stateRef.current;
    if (!ws || current.localPlayerName !== current.owner) return;
    ws.send(JSON.stringify({ type: "timer_next" }));
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
    toggleStar,
    setCounter,
    addNote,
    updateNote,
    deleteNote,
    reorderNotes,
    submitTimers,
    timerStart,
    timerPause,
    timerStop,
    timerNext,
    requestRestart,
    canRestart,
    joinError,
    joinPending,
    retryJoin,
    kickPlayer,
    kickNotice,
    changeCode,
    connectionStatus: state.connection,
    stars: state.stars,
    counters: state.counters,
    notes: state.notes,
    unreadChat: state.unreadChat,
    myCode: state.myCode,
    markChatUnread,
    clearChatUnread,
  };
}
