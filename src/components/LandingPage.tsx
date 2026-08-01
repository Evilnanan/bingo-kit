import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type {
  BoardConfig,
  GameMode,
  GoalItem,
  GoalPool,
  RoomConfig,
} from "../types";
import {
  getGoalText,
  getGoalGlobalGroup,
  getGoalImages,
  stripGoalMeta,
} from "../types";
import { pickGoals, type PickRule } from "../randomPicks";
import { computeConfigHash } from "../utils/configHash";
import { HEX_MIN_SIZE, HEX_MAX_SIZE } from "../hex/hexTypes";
import { GoalEditor } from "./GoalEditor";
import { ScoringRulePicker } from "./ScoringRulePicker";
import { GoalPoolManager } from "./GoalPoolManager";
import { loadPools, savePools } from "../utils/goalPoolStorage";
import {
  getBatchImageData,
  mergeDataMapIntoGoals,
  deleteOrphanedData,
  isAvailable as isIDBAvailable,
} from "../utils/imageDataStore";
import { ImageUploadQueue } from "../utils/imageService";
import type { ScoringRule } from "../scoring/types";
import { DEFAULT_SERVER_URL, IMAGE_URL } from "../config";
import "./LandingPage.css";

function getRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || "";
}

function getModeFromUrl(): GameMode {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "hex" ? "hex" : "classic";
}

function getServerFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("server") || "";
}

function getShareFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("share");
}

const DEFAULT_GOALS: GoalItem[] = [
  "Find a hidden item",
  "Defeat a boss",
  "Talk to an NPC",
  "Complete a side quest",
  "Discover a new area",
  "Collect 100 coins",
  "Use a special ability",
  "Open a locked door",
  "Solve a puzzle",
  "Reach a checkpoint",
  "Find a secret passage",
  "Purchase an upgrade",
  "Defeat 10 enemies",
  "Complete a level",
  "Find a rare item",
  "Activate a switch",
  "Cross a bridge",
  "Ride a vehicle",
  "Swim underwater",
  "Read some lore",
  "Break a target",
  "Fall into a pit",
  "Earn an achievement",
  "Change equipment",
  "Win a minigame",
];

const ANIMALS = [
  "Fox",
  "Owl",
  "Bear",
  "Wolf",
  "Hawk",
  "Lynx",
  "Deer",
  "Seal",
  "Crab",
  "Frog",
  "Crow",
  "Panda",
  "Duck",
  "Mole",
  "Bat",
  "Eel",
  "Hare",
  "Bee",
  "Elk",
  "Jay",
];

const ROOM_ADJECTIVES = [
  "Cozy",
  "Rusty",
  "Crystal",
  "Misty",
  "Sunny",
  "Dark",
  "Golden",
  "Silver",
  "Emerald",
  "Frozen",
  "Hidden",
  "Lucky",
  "Secret",
  "Silent",
  "Brave",
];

const ROOM_NOUNS = [
  "Cave",
  "Tavern",
  "Tower",
  "Forest",
  "Harbor",
  "Castle",
  "Temple",
  "Garden",
  "Meadow",
  "Library",
  "Den",
  "Hollow",
  "Lagoon",
  "Summit",
  "Sanctuary",
];

function randomRoomName(): string {
  const adj =
    ROOM_ADJECTIVES[Math.floor(Math.random() * ROOM_ADJECTIVES.length)];
  const noun = ROOM_NOUNS[Math.floor(Math.random() * ROOM_NOUNS.length)];
  return `${adj} ${noun}`;
}

function initPools(): { pools: GoalPool[]; currentPoolId: string } {
  const pools = loadPools();
  if (pools.length > 0) {
    return { pools, currentPoolId: pools[0].id };
  }
  // No pools exist — create the default "示例" pool
  const now = Date.now();
  const defaultPool: GoalPool = {
    id: "default",
    name: "示例",
    goals: [...DEFAULT_GOALS],
    createdAt: now,
    updatedAt: now,
  };
  savePools([defaultPool]);
  return { pools: [defaultPool], currentPoolId: defaultPool.id };
}

let _poolsInitCache: { pools: GoalPool[]; currentPoolId: string } | null = null;
function getInitPools() {
  if (!_poolsInitCache) _poolsInitCache = initPools();
  return _poolsInitCache;
}

const HEX_DEFAULT_SIZE_BLUE = 5;
const HEX_DEFAULT_SIZE_RED = 5;

interface Props {
  onJoinRoom: (config: RoomConfig) => void;
}

export function LandingPage({ onJoinRoom }: Props) {
  const { t } = useT();
  const [gameMode, setGameMode] = useState<GameMode>(() => getModeFromUrl());
  const [roomName, setRoomName] = useState(
    () => getRoomFromUrl() || randomRoomName(),
  );
  const [playerName, setPlayerName] = useState(
    () => ANIMALS[Math.floor(Math.random() * ANIMALS.length)],
  );
  const [serverUrl, setServerUrl] = useState(() => getServerFromUrl());
  const [imageServerUrl, setImageServerUrl] = useState(
    () => new URLSearchParams(window.location.search).get("images") || "",
  );
  const isSharedLink = getShareFromUrl();

  // Goal pool state
  const [pools, setPools] = useState<GoalPool[]>(() => getInitPools().pools);
  const [currentPoolId, setCurrentPoolId] = useState(
    () => getInitPools().currentPoolId,
  );
  const [poolManagerOpen, setPoolManagerOpen] = useState(false);

  const currentPool = pools.find((p) => p.id === currentPoolId) ?? pools[0];
  const [goals, setGoals] = useState<GoalItem[]>(
    () => currentPool?.goals ?? [...DEFAULT_GOALS],
  );
  const goalsRef = useRef(goals);

  const [editorOpen, setEditorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Upload queue — created once, never recreated when server/image host change
  const [uploadQueue] = useState<ImageUploadQueue>(
    () =>
      new ImageUploadQueue(
        serverUrl.trim() || DEFAULT_SERVER_URL,
        2,
        imageServerUrl.trim() || IMAGE_URL,
      ),
  );

  // 从 localStorage 恢复的任务池图片没有上传记录，静默入队重新上传；
  // 服务器已有该图片（哈希即存储键）时队列会通过 HEAD 复用跳过，不重复传数据。
  // 失败过的图片不自动重试（由编辑器手动重试）。
  useEffect(() => {
    for (const goal of goals) {
      for (const att of getGoalImages(goal)) {
        if (!att.data) continue;
        if (uploadQueue.getStatus(att.hash).status === "error") continue;
        uploadQueue.enqueue(att);
      }
    }
  }, [goals, uploadQueue]);

  // 从 IndexedDB 恢复图片 base64 data（localStorage 只存元数据）。
  // 只用函数式 setState 填补缺失的 data，不覆盖并发编辑的其他字段。
  useEffect(() => {
    if (!isIDBAvailable()) return;
    let cancelled = false;
    const hashes = new Set<string>();
    for (const pool of pools) {
      for (const goal of pool.goals) {
        for (const att of getGoalImages(goal)) {
          if (!att.data && att.hash) hashes.add(att.hash);
        }
      }
    }
    if (hashes.size === 0) return;
    getBatchImageData([...hashes]).then((dataMap) => {
      if (cancelled || dataMap.size === 0) return;
      setPools((current) =>
        current.map((pool) => ({
          ...pool,
          goals: mergeDataMapIntoGoals(pool.goals, dataMap),
        })),
      );
      setGoals((current) => mergeDataMapIntoGoals(current, dataMap));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 定期清理 IndexedDB 中不再被任何池子引用的孤儿图片记录
  // （如删除池子后残留）。每次打开页面延迟执行一次；活跃 hash 跨池收集，
  // 被多个池子共用的图片不会被误删。
  useEffect(() => {
    if (!isIDBAvailable()) return;
    const timer = setTimeout(() => {
      const activeHashes = new Set<string>();
      for (const pool of pools) {
        for (const goal of pool.goals) {
          for (const att of getGoalImages(goal)) {
            if (att.hash) activeHashes.add(att.hash);
          }
        }
      }
      deleteOrphanedData(activeHashes).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hex state
  const [sizeBlue, setSizeBlue] = useState(HEX_DEFAULT_SIZE_BLUE);
  const [sizeRed, setSizeRed] = useState(HEX_DEFAULT_SIZE_RED);
  const [lockout, setLockout] = useState(false);
  const [error, setError] = useState("");
  const [selectedScoringRule, setSelectedScoringRule] =
    useState<ScoringRule | null>(null);

  // Pick rule settings
  const [pickRule, setPickRule] = useState<PickRule>({ algorithm: "pure" });
  const [cfgMin, setCfgMin] = useState(1);
  const [cfgMax, setCfgMax] = useState(5);
  const [cfgCenter, setCfgCenter] = useState(true);
  const [cfgPattern, setCfgPattern] = useState("1,1,1,2,3");

  const syncPoolGoals = (g: GoalItem[]) => {
    const now = Date.now();
    const updated = pools.map((p) =>
      p.id === currentPoolId ? { ...p, goals: g, updatedAt: now } : p,
    );
    setPools(updated);
    savePools(updated);
  };

  const switchToPool = (poolId: string) => {
    const pool = pools.find((p) => p.id === poolId);
    if (!pool) return;
    setCurrentPoolId(poolId);
    setGoals(pool.goals);
    goalsRef.current = pool.goals;
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmedRoom = roomName.trim();
    const trimmedName = playerName.trim();
    const resolvedServer = serverUrl.trim() || DEFAULT_SERVER_URL;
    const resolvedImageUrl = imageServerUrl.trim() || IMAGE_URL;
    if (!trimmedRoom || !trimmedName) return;

    // Visitor via share link: skip goal validation, send minimal config.
    // The server already holds the authoritative config and will push it back.
    if (isSharedLink) {
      setError("");
      onJoinRoom({
        gameMode,
        roomName: trimmedRoom,
        playerName: trimmedName,
        serverUrl: resolvedServer,
        imageHost: resolvedImageUrl,
        boardConfig: { goals: [] },
        ...(gameMode === "hex"
          ? {
              hexConfig: {
                sizeBlue: HEX_DEFAULT_SIZE_BLUE,
                sizeRed: HEX_DEFAULT_SIZE_RED,
                goals: [],
              },
            }
          : {}),
      });
      return;
    }

    const validGoals = goals.filter((g) => getGoalText(g).length > 0);
    if (validGoals.length === 0) {
      setError(t["landing.noGoals"]);
      return;
    }

    // Wait for any pending image uploads before joining
    if (uploadQueue.hasErrors) {
      setUploading(true);
      try {
        await uploadQueue.waitForAll();
      } finally {
        setUploading(false);
      }
    }

    if (gameMode === "hex") {
      const sBlue =
        Math.max(HEX_MIN_SIZE, Math.min(sizeBlue, HEX_MAX_SIZE)) ||
        HEX_DEFAULT_SIZE_BLUE;
      const sRed =
        Math.max(HEX_MIN_SIZE, Math.min(sizeRed, HEX_MAX_SIZE)) ||
        HEX_DEFAULT_SIZE_RED;
      const totalCells = sBlue * sRed;

      const shuffled = [...validGoals].sort(() => Math.random() - 0.5);
      const usedGlobal = new Set<string>();
      const picked: GoalItem[] = [];
      for (const g of shuffled) {
        if (picked.length >= totalCells) break;
        const ggs = getGoalGlobalGroup(g);
        if (ggs.some((gg) => usedGlobal.has(gg))) continue;
        picked.push(g);
        for (const gg of ggs) usedGlobal.add(gg);
      }

      if (picked.length < totalCells) {
        setError(t["landing.notEnoughGoals"]);
        return;
      }

      setError("");
      const configHash = computeConfigHash({
        goals: validGoals,
        sizeBlue: sBlue,
        sizeRed: sRed,
      });
      onJoinRoom({
        gameMode: "hex",
        roomName: trimmedRoom,
        playerName: trimmedName,
        serverUrl: resolvedServer,
        imageHost: resolvedImageUrl,
        boardConfig: { goals: [] },
        hexConfig: {
          sizeBlue: sBlue,
          sizeRed: sRed,
          goals: stripGoalMeta(picked),
          configHash,
        },
      });
      return;
    }

    // Classic mode: apply pick rule to goal pool
    const picked = pickGoals(validGoals, pickRule);

    if (picked.length < 25) {
      setError(t["landing.notEnoughGoals"]);
      return;
    }

    setError("");
    const boardGoals = picked.slice(0, 25);

    const configHash = computeConfigHash({
      goals,
      pickRule,
      scoringRule: selectedScoringRule ?? undefined,
      lockout,
    });

    const boardConfig: BoardConfig = {
      goals: stripGoalMeta(boardGoals),
      lockout,
      ...(selectedScoringRule ? { scoringRule: selectedScoringRule } : {}),
      originalPool: goals,
      pickRule,
      configHash,
    };

    onJoinRoom({
      gameMode: "classic",
      roomName: trimmedRoom,
      playerName: trimmedName,
      serverUrl: resolvedServer,
      imageHost: resolvedImageUrl,
      boardConfig,
    });
  };

  const handleGoalsChange = (g: GoalItem[]) => {
    goalsRef.current = g;
    setGoals(g);
    // Auto-save to current pool
    syncPoolGoals(g);
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    syncPoolGoals(goalsRef.current);
  };

  const bingoTitle = t["landing.title"];

  return (
    <div className="landing">
      <h1 className="landing-title">{bingoTitle}</h1>
      <p className="landing-subtitle">{t["landing.subtitle"]}</p>

      <form className="landing-form" onSubmit={handleSubmit}>
        {/* Game Mode Selector */}
        <div className="mode-selector">
          <span className="mode-label">{t["mode.label"]}</span>
          <div className="mode-tabs">
            <button
              type="button"
              className={`mode-tab${gameMode === "classic" ? " mode-tab--active" : ""}`}
              onClick={() => setGameMode("classic")}
              disabled={isSharedLink}
            >
              {t["mode.classic"]}
            </button>
            <button
              type="button"
              className={`mode-tab${gameMode === "hex" ? " mode-tab--active" : ""}`}
              onClick={() => setGameMode("hex")}
              disabled={isSharedLink}
            >
              {t["mode.hex"]}
            </button>
          </div>
        </div>

        <div className="form-row">
          <label className="form-label">
            {t["landing.roomName"]}
            <span className="room-name-row">
              <input
                className="form-input room-name-input"
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder={t["landing.roomPlaceholder"]}
                required
                autoFocus
                disabled={isSharedLink}
              />
              <button
                type="button"
                className="random-room-btn"
                title={t["landing.randomRoom"]}
                onClick={() => setRoomName(randomRoomName())}
                disabled={isSharedLink}
              >
                &#x21bb;
              </button>
            </span>
          </label>

          <label className="form-label">
            {t["landing.yourName"]}
            <input
              className="form-input"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder={t["landing.namePlaceholder"]}
              required
            />
          </label>
        </div>

        <label className="form-label">
          <span>
            <a
              href="https://docs.partykit.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="channel-link"
            >
              PartyKit
            </a>{" "}
            {t["landing.server"]}
          </span>
          <input
            className="form-input"
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder={DEFAULT_SERVER_URL}
            disabled={isSharedLink}
          />
        </label>

        <label className="form-label">
          <span>
            <a
              href="https://developers.cloudflare.com/r2/"
              target="_blank"
              rel="noopener noreferrer"
              className="channel-link"
            >
              Cloudflare R2
            </a>{" "}
            {t["landing.imageServer"]}
          </span>
          <input
            className="form-input"
            type="text"
            value={imageServerUrl}
            onChange={(e) => setImageServerUrl(e.target.value)}
            placeholder={IMAGE_URL || serverUrl.trim() || DEFAULT_SERVER_URL}
            disabled={isSharedLink}
          />
        </label>

        {/* Goal pool — shared between classic and hex */}
        <div className="form-label">
          {t["landing.goalPoolHeading"]}
          <div className="goal-pool-row">
            <select
              className="form-input goal-pool-select"
              value={currentPoolId}
              onChange={(e) => {
                // Save current goals before switching
                syncPoolGoals(goalsRef.current);
                switchToPool(e.target.value);
              }}
              disabled={isSharedLink}
            >
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="form-input goal-pool-btn"
              onClick={() => setPoolManagerOpen(true)}
              disabled={isSharedLink}
            >
              {t["goalPool.manage"]}
            </button>
            <button
              type="button"
              className="form-input goal-pool-btn"
              onClick={() => setEditorOpen(true)}
              disabled={isSharedLink}
            >
              {t["editor.goalEditor"]}
            </button>
          </div>
        </div>

        {/* Hex size config */}
        <div style={{ display: gameMode === "hex" ? undefined : "none" }}>
          <div className="form-row hex-size-row">
            <label className="form-label">
              {t["hex.sizeBlue"]}
              <input
                className="form-input hex-size-input"
                type="number"
                min={HEX_MIN_SIZE}
                max={HEX_MAX_SIZE}
                value={Number.isNaN(sizeBlue) ? "" : sizeBlue}
                onChange={(e) => {
                  if (e.target.value === "") setSizeBlue(NaN);
                  else
                    setSizeBlue(
                      Math.min(
                        HEX_MAX_SIZE,
                        Math.max(HEX_MIN_SIZE, Number(e.target.value)),
                      ),
                    );
                }}
                disabled={isSharedLink}
              />
            </label>
            <label className="form-label">
              {t["hex.sizeRed"]}
              <input
                className="form-input hex-size-input"
                type="number"
                min={HEX_MIN_SIZE}
                max={HEX_MAX_SIZE}
                value={Number.isNaN(sizeRed) ? "" : sizeRed}
                onChange={(e) => {
                  if (e.target.value === "") setSizeRed(NaN);
                  else
                    setSizeRed(
                      Math.min(
                        HEX_MAX_SIZE,
                        Math.max(HEX_MIN_SIZE, Number(e.target.value)),
                      ),
                    );
                }}
                disabled={isSharedLink}
              />
            </label>
          </div>
        </div>

        {/* Pick rule settings — classic only */}
        <div style={{ display: gameMode === "hex" ? "none" : undefined }}>
          <label className="form-label">
            {t["editor.pickRule"]}
            <select
              className="form-input pick-rule-select"
              value={pickRule.algorithm}
              onChange={(e) => {
                const algo = e.target.value as PickRule["algorithm"];
                if (algo === "balanced")
                  setPickRule({
                    algorithm: "balanced",
                    minDifficulty: cfgMin,
                    maxDifficulty: cfgMax,
                    centerHardest: cfgCenter,
                  });
                else if (algo === "pattern")
                  setPickRule({ algorithm: "pattern", pattern: cfgPattern });
                else setPickRule({ algorithm: algo });
              }}
              disabled={isSharedLink}
            >
              <option value="pure">{t["editor.pickRulePure"]}</option>
              <option value="balanced">{t["editor.pickRuleBalanced"]}</option>
              <option value="pattern">{t["editor.pickRulePattern"]}</option>
              <option value="fixed">{t["editor.pickRuleFixed"]}</option>
            </select>
          </label>

          {pickRule.algorithm === "balanced" && (
            <>
              <label className="form-label">
                {t["editor.pickDiffRange"]}
                <span className="pick-inline">
                  <input
                    type="number"
                    className="form-input pick-num"
                    min={1}
                    max={5}
                    value={cfgMin}
                    onChange={(e) => {
                      const v = Math.max(1, parseInt(e.target.value) || 1);
                      setCfgMin(v);
                      setPickRule((r) =>
                        r.algorithm === "balanced"
                          ? { ...r, minDifficulty: v }
                          : r,
                      );
                    }}
                    disabled={isSharedLink}
                  />
                  <span> ~ </span>
                  <input
                    type="number"
                    className="form-input pick-num"
                    min={1}
                    max={5}
                    value={cfgMax}
                    onChange={(e) => {
                      const v = Math.min(5, parseInt(e.target.value) || 5);
                      setCfgMax(v);
                      setPickRule((r) =>
                        r.algorithm === "balanced"
                          ? { ...r, maxDifficulty: v }
                          : r,
                      );
                    }}
                    disabled={isSharedLink}
                  />
                </span>
              </label>
              <label className="pick-check">
                <input
                  type="checkbox"
                  checked={cfgCenter}
                  onChange={(e) => {
                    setCfgCenter(e.target.checked);
                    setPickRule((r) =>
                      r.algorithm === "balanced"
                        ? { ...r, centerHardest: e.target.checked }
                        : r,
                    );
                  }}
                  disabled={isSharedLink}
                />
                {t["editor.pickCenterHardest"]}
              </label>
            </>
          )}

          {pickRule.algorithm === "pattern" && (
            <>
              <label className="form-label">
                {t["editor.pickPattern"]}
                <input
                  type="text"
                  className="form-input"
                  value={cfgPattern}
                  onChange={(e) => {
                    setCfgPattern(e.target.value);
                    setPickRule((r) =>
                      r.algorithm === "pattern"
                        ? { ...r, pattern: e.target.value }
                        : r,
                    );
                  }}
                  placeholder="1,1,1,2,3"
                  disabled={isSharedLink}
                />
              </label>
              <p className="pick-hint">{t["editor.pickPatternHint"]}</p>
            </>
          )}

          {pickRule.algorithm === "fixed" && (
            <p className="pick-hint">{t["editor.pickFixedHint"]}</p>
          )}
        </div>

        {/* Lockout mode — classic only */}
        <div style={{ display: gameMode === "hex" ? "none" : undefined }}>
          <div className="lockout-row">
            <label className="lockout-label">
              <input
                type="checkbox"
                className="lockout-checkbox"
                checked={lockout}
                onChange={(e) => setLockout(e.target.checked)}
                disabled={isSharedLink}
              />
              <span className="lockout-toggle-slider" />
              <span>{t["landing.lockout"]}</span>
            </label>
          </div>
        </div>

        {/* Scoring rules — classic only */}
        <div style={{ display: gameMode === "hex" ? "none" : undefined }}>
          <ScoringRulePicker
            selectedRule={selectedScoringRule}
            onSelect={setSelectedScoringRule}
            disabled={isSharedLink}
          />
        </div>

        {error && <p className="landing-error">{error}</p>}

        <button type="submit" className="join-button" disabled={uploading}>
          {uploading ? t["landing.uploadingImages"] : t["landing.joinButton"]}
        </button>
      </form>

      {!isSharedLink && editorOpen && (
        <GoalEditor
          goals={goals}
          onChange={handleGoalsChange}
          onClose={handleCloseEditor}
          uploadQueue={uploadQueue}
        />
      )}

      {!isSharedLink && poolManagerOpen && (
        <GoalPoolManager
          pools={pools}
          currentPoolId={currentPoolId}
          defaultGoals={DEFAULT_GOALS}
          onSelect={(id) => {
            switchToPool(id);
          }}
          onUpdate={(updated) => {
            setPools(updated);
            // If the current pool was deleted, auto-select the first remaining pool
            if (!updated.some((p) => p.id === currentPoolId)) {
              const first = updated[0];
              if (first) {
                setCurrentPoolId(first.id);
                setGoals(first.goals);
                goalsRef.current = first.goals;
              }
            }
          }}
          onClose={() => setPoolManagerOpen(false)}
        />
      )}
    </div>
  );
}
