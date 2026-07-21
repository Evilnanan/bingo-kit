import { useState, useCallback } from "react";
import type { ScoringRule } from "../scoring/types";
import { useT } from "../i18n/useT";
import { ScoringRuleEditor } from "./ScoringRuleEditor";
import "./ScoringRulePicker.css";

const STORAGE_KEY = "bingo-scoring-rules";

function loadRules(): ScoringRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ScoringRule[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveRules(rules: ScoringRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* ignore */
  }
}

interface Props {
  selectedRule: ScoringRule | null;
  onSelect: (rule: ScoringRule | null) => void;
  disabled?: boolean;
}

export function ScoringRulePicker({
  selectedRule,
  onSelect,
  disabled = false,
}: Props) {
  const { t } = useT();
  const [savedRules, setSavedRules] = useState<ScoringRule[]>(loadRules);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ScoringRule | null>(null);

  const isCustom = selectedRule !== null;

  const persist = useCallback((rules: ScoringRule[]) => {
    setSavedRules(rules);
    saveRules(rules);
  }, []);

  const handleSelectDefault = () => {
    onSelect(null);
  };

  const handleSelectCustom = (ruleId: string) => {
    const rule = savedRules.find((r) => r.id === ruleId);
    if (rule) onSelect(rule);
  };

  const openNew = () => {
    setEditingRule(null);
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selectedRule) return;
    setEditingRule(selectedRule);
    setEditorOpen(true);
  };

  const handleSave = (rule: ScoringRule) => {
    const existing = savedRules.findIndex((r) => r.id === rule.id);
    let updated: ScoringRule[];
    if (existing >= 0) {
      updated = [...savedRules];
      updated[existing] = rule;
    } else {
      updated = [...savedRules, rule];
    }
    persist(updated);
    onSelect(rule);
    setEditorOpen(false);
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    const updated = savedRules.filter((r) => r.id !== id);
    persist(updated);
    if (selectedRule?.id === id) {
      onSelect(null);
    }
    setEditorOpen(false);
    setEditingRule(null);
  };

  const handleCancel = () => {
    setEditorOpen(false);
    setEditingRule(null);
  };

  // Only show the whole section for classic mode (render controlled by parent)
  return (
    <div className="srp-root">
      <label className="srp-label">{t["scoring.title"]}</label>

      <div className="srp-options">
        {/* Default */}
        <label className="srp-radio">
          <input
            type="radio"
            name="scoring-rule"
            checked={!isCustom}
            onChange={handleSelectDefault}
            disabled={disabled}
          />
          <span>{t["scoring.default"]}</span>
        </label>

        {/* Custom */}
        <label className="srp-radio">
          <input
            type="radio"
            name="scoring-rule"
            checked={isCustom}
            onChange={() => {
              if (savedRules.length > 0) {
                onSelect(savedRules[0]);
              } else {
                openNew();
              }
            }}
            disabled={disabled}
          />
          <span>{t["scoring.custom"]}</span>
        </label>
      </div>

      {isCustom && (
        <div className="srp-custom-section">
          <select
            className="srp-select"
            value={selectedRule?.id ?? ""}
            onChange={(e) => handleSelectCustom(e.target.value)}
            disabled={disabled}
          >
            {savedRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.items.length} items)
              </option>
            ))}
          </select>
          <div className="srp-custom-actions">
            <button
              type="button"
              className="srp-btn"
              onClick={openNew}
              disabled={disabled}
            >
              {t["scoring.newRule"]}
            </button>
            <button
              type="button"
              className="srp-btn"
              onClick={openEdit}
              disabled={disabled}
            >
              {t["scoring.editRule"]}
            </button>
            {savedRules.length > 1 && (
              <button
                type="button"
                className="srp-btn srp-btn--danger"
                onClick={() => {
                  if (selectedRule && window.confirm("Delete this rule?")) {
                    handleDeleteRule(selectedRule.id);
                  }
                }}
                disabled={disabled}
              >
                {t["scoring.delete"]}
              </button>
            )}
          </div>

          {/* Preview */}
          {selectedRule && (
            <div className="srp-preview">
              {selectedRule.items.map((item) => (
                <div key={item.id} className="srp-preview-item">
                  <span className="srp-preview-target">
                    {item.target === "cell"
                      ? t["scoring.targetCell"]
                      : t["scoring.targetBingo"]}
                  </span>
                  <code className="srp-preview-points">{item.points}</code>
                  {item.condition && (
                    <code className="srp-preview-cond">
                      if {item.condition}
                    </code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editorOpen && (
        <ScoringRuleEditor
          rule={editingRule}
          onSave={handleSave}
          onCancel={handleCancel}
          onDelete={editingRule ? handleDeleteRule : undefined}
          existingNames={savedRules
            .filter((r) => r.id !== editingRule?.id)
            .map((r) => r.name)}
        />
      )}
    </div>
  );
}
