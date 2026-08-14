import { useState } from "react";
import { useT, format } from "../i18n/useT";
import { EyeIcon, EyeOffIcon } from "./EyeIcons";
import "./JoinRejectedModal.css";

interface Props {
  /** The player name that is already taken in the room. */
  name: string;
  /** Which retry path is awaiting the server's answer ("code" or "name"). */
  pending?: "code" | "name" | null;
  /** Join as a brand-new player under a different name. */
  onJoinWithName: (name: string) => void;
  /** Join as the existing player by proving the identity code. */
  onJoinWithCode: (code: string) => void;
  /** Give up and leave the room. */
  onCancel: () => void;
}

export function JoinRejectedModal({
  name,
  pending,
  onJoinWithName,
  onJoinWithCode,
  onCancel,
}: Props) {
  const { t } = useT();
  const [nameInput, setNameInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeVisible, setCodeVisible] = useState(false);
  // Whether the user has submitted a (non-empty) code attempt. The "wrong
  // code" error only makes sense after such an attempt — the modal shouldn't
  // show it while the input is still empty (e.g. right after joining).
  const [codeSubmitted, setCodeSubmitted] = useState(false);

  const submitName = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed) {
      // A rename attempt supersedes the previous code attempt: don't let the
      // "wrong code" error resurface after the server answers this request.
      setCodeSubmitted(false);
      onJoinWithName(trimmed);
    }
  };

  const submitCode = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = codeInput.trim();
    if (trimmed) {
      setCodeSubmitted(true);
      onJoinWithCode(trimmed);
    }
  };

  return (
    <div className="join-rejected-overlay">
      <div className="join-rejected-modal" role="dialog" aria-modal="true">
        <h2 className="join-rejected-title">{t["joinRejected.title"]}</h2>
        <p className="join-rejected-text">
          {format(t["joinRejected.text"], name)}
        </p>

        <form className="join-rejected-form" onSubmit={submitCode}>
          <p className="join-rejected-hint">{t["joinRejected.otherDevice"]}</p>
          <div className="join-rejected-row">
            <span className="join-rejected-code-wrap">
              <input
                className="join-rejected-input"
                type={codeVisible ? "text" : "password"}
                value={codeInput}
                onChange={(e) => {
                  setCodeInput(e.target.value);
                  setCodeSubmitted(false);
                }}
                placeholder={t["joinRejected.codePlaceholder"]}
                maxLength={32}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="join-rejected-eye"
                onClick={() => setCodeVisible((v) => !v)}
                title={
                  codeVisible ? t["settings.codeHide"] : t["settings.codeShow"]
                }
                aria-label={
                  codeVisible ? t["settings.codeHide"] : t["settings.codeShow"]
                }
              >
                {codeVisible ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
            <button
              type="submit"
              className="join-rejected-btn join-rejected-btn--primary"
              disabled={!codeInput.trim() || pending !== null}
            >
              {pending === "code" ? (
                <span className="join-rejected-spinner" aria-hidden="true" />
              ) : (
                t["joinRejected.joinAsSelf"]
              )}
            </button>
          </div>
          {codeSubmitted && codeInput.trim() !== "" && pending === null && (
            <p className="join-rejected-error" role="alert">
              {t["joinRejected.badCode"]}
            </p>
          )}
        </form>

        <form className="join-rejected-form" onSubmit={submitName}>
          <p className="join-rejected-hint">{t["joinRejected.orRename"]}</p>
          <div className="join-rejected-row">
            <input
              className="join-rejected-input"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t["joinRejected.namePlaceholder"]}
              maxLength={30}
              spellCheck={false}
            />
            <button
              type="submit"
              className="join-rejected-btn join-rejected-btn--primary"
              disabled={!nameInput.trim() || pending !== null}
            >
              {pending === "name" ? (
                <span className="join-rejected-spinner" aria-hidden="true" />
              ) : (
                t["joinRejected.joinWithName"]
              )}
            </button>
          </div>
        </form>

        <p className="join-rejected-guide">{t["joinRejected.howTo"]}</p>

        <button
          type="button"
          className="join-rejected-cancel"
          onClick={onCancel}
        >
          {t["joinRejected.cancel"]}
        </button>
      </div>
    </div>
  );
}
