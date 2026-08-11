import { useRef, useEffect } from "react";
import PartySocket from "partysocket";
import { compressJson } from "../utils/compressMessage";
import { DEFAULT_SERVER_URL } from "../config";
import type {
  ChatMessage,
  PlayerCallbackAction,
  CommonStateFields,
  CommonAction,
  ClientMessage,
  ServerMessage,
  GameMode,
  GameAction,
  PoolMetadata,
} from "../types";

// ============================================================
// handleCommonAction — unchanged from useScaledrone
// ============================================================

export function handleCommonAction<S extends CommonStateFields>(
  state: S,
  action: CommonAction,
): S {
  switch (action.type) {
    case "SET_CLIENT_ID":
      return { ...state, localClientId: action.clientId };

    case "SET_LOCAL_PLAYER_NAME":
      return { ...state, localPlayerName: action.name };

    case "REMOVE_PLAYER": {
      if (!state.players[action.playerName]) return state;
      const newPlayers = { ...state.players };
      delete newPlayers[action.playerName];
      return { ...state, players: newPlayers };
    }

    case "CLEAR_SESSION":
      return {
        ...state,
        players: {},
        localClientId: null,
        localPlayerName: null,
        chats: [],
      };

    case "UPDATE_PLAYER_COLOR": {
      const player = state.players[action.playerName];
      if (!player) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [action.playerName]: { ...player, color: action.color },
        },
      };
    }

    case "RENAME_PLAYER": {
      const { oldName, newName } = action;
      if (oldName === newName) return state;
      if (state.players[newName]) return state;
      const player = state.players[oldName];
      if (!player) return state;
      const newPlayers = { ...state.players };
      delete newPlayers[oldName];
      newPlayers[newName] = { ...player, name: newName };
      return {
        ...state,
        players: newPlayers,
        localPlayerName:
          state.localPlayerName === oldName ? newName : state.localPlayerName,
        owner: state.owner === oldName ? newName : state.owner,
      };
    }

    case "ADD_CHAT":
      return { ...state, chats: [...state.chats, action.msg] };

    default:
      return state;
  }
}

// ============================================================
// usePlayerCallbacks — adapted for PartySocket
// ============================================================

interface PlayerCallbacksState {
  localPlayerName: string | null;
  players: Record<string, { name: string; color: string }>;
}

export function usePlayerCallbacks(
  wsRef: React.RefObject<PartySocket | null>,
  stateRef: React.RefObject<PlayerCallbacksState>,
  dispatch: React.Dispatch<PlayerCallbackAction>,
) {
  function changeColor(color: string) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;

    ws.send(
      JSON.stringify({
        type: "change_color",
        name: myName,
        color,
      } satisfies ClientMessage),
    );
    dispatch({ type: "UPDATE_PLAYER_COLOR", playerName: myName, color });
  }

  function changeName(newName: string) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;
    if (newName === myName) return;
    if (!newName.trim()) return;
    if (stateRef.current.players[newName.trim()]) return;

    ws.send(
      JSON.stringify({
        type: "rename",
        oldName: myName,
        newName: newName.trim(),
      } satisfies ClientMessage),
    );
    dispatch({
      type: "RENAME_PLAYER",
      oldName: myName,
      newName: newName.trim(),
    });
  }

  function sendChat(text: string) {
    const ws = wsRef.current;
    const myName = stateRef.current.localPlayerName;
    if (!myName || !ws) return;

    const player = stateRef.current.players[myName];
    if (!player) return;

    ws.send(
      JSON.stringify({
        type: "chat",
        name: player.name,
        color: player.color,
        text,
      } satisfies ClientMessage),
    );

    const msg: ChatMessage = {
      name: player.name,
      color: player.color,
      text,
      timestamp: Date.now(),
    };
    dispatch({ type: "ADD_CHAT", msg });
  }

  return { changeColor, changeName, sendChat };
}

// ============================================================
// usePartyConnection — main connection hook
// ============================================================

/** How often the client sends an app-level heartbeat while connected. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * If the server hasn't answered a heartbeat within this window, treat the
 * socket as a zombie (network blackholed, tab suspended) and force a fresh
 * connection. Background-tab timers are throttled to ~1/min, so this is well
 * above one interval and below Cloudflare's ~100s idle cutoff.
 */
const HEARTBEAT_STALE_MS = 90_000;

export function usePartyConnection(params: {
  serverUrl: string;
  roomName: string;
  playerName: string;
  config: unknown;
  metadata?: PoolMetadata;
  mode: GameMode;
  lockout: boolean;
  dispatch: React.Dispatch<GameAction>;
  wsRef: React.RefObject<PartySocket | null>;
  onMessage: (msg: ServerMessage) => void;
  enabled?: boolean;
}) {
  const {
    serverUrl,
    roomName,
    playerName,
    config,
    metadata,
    mode,
    lockout,
    dispatch,
    wsRef,
    onMessage,
    enabled = true,
  } = params;

  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  const genRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const gen = ++genRef.current;
    dispatch({ type: "CLEAR_SESSION" });

    const host = serverUrl || DEFAULT_SERVER_URL;

    const ws = new PartySocket({
      host,
      // PartyServer routes /parties/:server/:room by kebab-casing the
      // Durable Object binding name (BingoServer -> bingo-server).
      party: "bingo-server",
      room: roomName,
    });
    wsRef.current = ws;
    let lastPong = Date.now();

    ws.addEventListener("open", () => {
      if (genRef.current !== gen) return;
      lastPong = Date.now();

      // Generate a synthetic client ID (server doesn't expose connection IDs to us)
      const clientId = "c-" + Math.random().toString(36).slice(2, 10);
      dispatch({ type: "SET_CLIENT_ID", clientId });
      dispatch({ type: "SET_LOCAL_PLAYER_NAME", name: playerName });

      // Announce ourselves to the server — compress config to save bandwidth
      ws.send(
        JSON.stringify({
          type: "join",
          name: playerName,
          config: config != null ? compressJson(config) : null,
          metadata,
          mode,
          lockout,
          configHash:
            (config as { configHash?: string } | null)?.configHash ?? undefined,
        } satisfies ClientMessage),
      );
    });

    ws.addEventListener("message", (event: Event) => {
      if (genRef.current !== gen) return;
      const msgEvent = event as MessageEvent;
      let data: ServerMessage;
      try {
        data = JSON.parse(msgEvent.data as string);
      } catch {
        return;
      }
      // Heartbeat ack — just refreshes liveness, nothing for game state.
      if (data.type === "pong") {
        lastPong = Date.now();
        return;
      }
      onMessageRef.current(data);
    });

    ws.addEventListener("error", (event: Event) => {
      console.error("PartySocket error:", event);
    });

    // Keep the connection alive while the tab is in the background: Cloudflare
    // closes proxied WebSockets after ~100s without traffic, and a backgrounded
    // tab produces no user-driven messages. Browsers can't send protocol-level
    // ping frames, so we send a tiny app-level ping instead. If the server
    // stops answering, force a reconnect rather than sitting on a dead socket.
    const heartbeatId = window.setInterval(() => {
      if (genRef.current !== gen) return;
      const socket = wsRef.current;
      if (!socket || socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
      if (Date.now() - lastPong > HEARTBEAT_STALE_MS) {
        socket.reconnect();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // When the tab becomes visible again after a drop, reconnect immediately
    // instead of waiting for PartySocket's backoff timer.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (genRef.current !== gen) return;
      const socket = wsRef.current;
      if (socket && socket.readyState !== socket.OPEN) socket.reconnect();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Explicitly leaving the page (close tab / navigate / back) is an active
    // exit: tell the server so it removes us immediately instead of waiting
    // out the reconnect grace period. Pure backgrounding (visibilitychange
    // to "hidden") intentionally does NOT leave.
    const handlePageHide = () => {
      if (genRef.current !== gen) return;
      const socket = wsRef.current;
      if (socket && socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "leave",
            name: playerName,
          } satisfies ClientMessage),
        );
      }
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      ws.close();
      wsRef.current = null;
      genRef.current = 0;
    };
    // Intentionally exclude config, metadata, mode, lockout from deps — they're
    // captured at connection time and shouldn't trigger reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, roomName, playerName, dispatch, enabled]);
}

// Re-export for backward compatibility within the codebase
export type { GameAction } from "../types";
