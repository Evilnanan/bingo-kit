import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";
import { useT } from "../i18n/useT";
import "./ChatPanel.css";

interface Props {
  chats: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatPanel({ chats, onSend }: Props) {
  const [input, setInput] = useState("");
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
      <h3 className="chat-title">{t["chat.title"]}</h3>
      <div className="chat-messages">
        {chats.length === 0 && <p className="chat-empty">{t["chat.empty"]}</p>}
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
    </div>
  );
}
