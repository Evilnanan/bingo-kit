import { useState } from "react";
import type { ScoringRule } from "../scoring/types";
import { DEFAULT_SCORING_RULE } from "../scoring/defaultRule";
import { useT, format } from "../i18n/useT";
import "./ScoringRuleCard.css";

interface Props {
  rule: ScoringRule | undefined | null;
}

function isSimpleExpr(expr: string): boolean {
  return /^[\d+\-*/().\s]+$/.test(expr) && expr.length <= 8;
}

export function ScoringRuleCard({ rule }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useT();

  const effective = rule ?? DEFAULT_SCORING_RULE;
  const isDefault = !rule || rule.id === "default";

  return (
    <div className={`rule-card${open ? " rule-card--open" : ""}`}>
      <button
        type="button"
        className="rule-card-header"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          open ? t["scoring.ruleCard.collapse"] : t["scoring.ruleCard.expand"]
        }
        title={
          open ? t["scoring.ruleCard.collapse"] : t["scoring.ruleCard.expand"]
        }
      >
        <span className="rule-card-icon">{open ? "▾" : "▸"}</span>
        <span className="rule-card-title">{t["scoring.title"]}</span>
        {!open && (
          <span className="rule-card-summary">
            {isDefault
              ? t["scoring.default"]
              : `${effective.name} · ${format(t["scoring.ruleCard.itemCount"], effective.items.length)}`}
          </span>
        )}
      </button>

      {open && (
        <div className="rule-card-body">
          {!isDefault && effective.name !== t["scoring.default"] && (
            <div className="rule-card-name">{effective.name}</div>
          )}
          <ul className="rule-card-items">
            {effective.items.map((item) => (
              <li key={item.id} className="rule-item">
                <div className="rule-item-head">
                  <span className="rule-item-target">
                    {item.target === "cell"
                      ? t["scoring.targetCell"]
                      : t["scoring.targetBingo"]}
                  </span>
                  {item.label && (
                    <span className="rule-item-label">{item.label}</span>
                  )}
                </div>
                {item.condition && (
                  <div className="rule-item-expr rule-item-expr--condition">
                    <span className="rule-item-expr-label">
                      {t["scoring.ruleCard.condition"]}:
                    </span>
                    <code className="rule-item-code">{item.condition}</code>
                  </div>
                )}
                <div className="rule-item-expr rule-item-expr--points">
                  <span className="rule-item-expr-label">
                    {t["scoring.ruleCard.points"]}:
                  </span>
                  {isSimpleExpr(item.points) ? (
                    <span className="rule-item-points-simple">
                      +{item.points}
                    </span>
                  ) : (
                    <code className="rule-item-code">{item.points}</code>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
