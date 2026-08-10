import { useState, useRef, useEffect } from "react";
import type { ChatMessage, PlayerNote } from "../types";
import { useT } from "../i18n/useT";
import { NotesPanel } from "./NotesPanel";
import "./ChatPanel.css";

interface Props {
  chats: ChatMessage[];
  onSend: (text: string) => void;
  notes: PlayerNote[];
  onAddNote: (text: string, todo: boolean) => void;
  onUpdateNote: (
    id: string,
    patch: { text?: string; todo?: boolean; done?: boolean },
  ) => void;
  onDeleteNote: (id: string) => void;
  onReorderNotes: (ids: string[]) => void;
}

export function ChatPanel({
  chats,
  onSend,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onReorderNotes,
}: Props) {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-tabs">
        <button
          type="button"
          className={`chat-tab${tab === "chat" ? " chat-tab--active" : ""}`}
          onClick={() => setTab("chat")}
        >
          {t["chat.title"]}
        </button>
        <button
          type="button"
          className={`chat-tab${tab === "notes" ? " chat-tab--active" : ""}`}
          onClick={() => setTab("notes")}
        >
          {t["notes.title"]}
        </button>
      </div>
      {tab === "chat" ? (
        <>
          <div className="chat-messages">
            {chats.length === 0 && (
              <p className="chat-empty">{t["chat.empty"]}</p>
            )}
            {chats.map((msg, i) => (
              <div key={i} className="chat-msg">
                <span
                  className="chat-msg-dot"
                  style={{ backgroundColor: msg.color }}
                />
                <span className="chat-msg-name">{msg.name}</span>
                <span className="chat-msg-text">{msg.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form className="chat-form" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t["chat.placeholder"]}
              maxLength={500}
            />
            <button type="submit" className="chat-send">
              {t["chat.send"]}
            </button>
          </form>
        </>
      ) : (
        <NotesPanel
          notes={notes}
          onAddNote={onAddNote}
          onUpdateNote={onUpdateNote}
          onDeleteNote={onDeleteNote}
          onReorderNotes={onReorderNotes}
        />
      )}
    </div>
  );
}
