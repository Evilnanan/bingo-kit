import { useRef, useState } from "react";
import type { PlayerNote } from "../types";
import { useT } from "../i18n/useT";
import "./NotesPanel.css";

interface Props {
  notes: PlayerNote[];
  onAddNote: (text: string, todo: boolean) => void;
  onUpdateNote: (
    id: string,
    patch: { text?: string; todo?: boolean; done?: boolean },
  ) => void;
  onDeleteNote: (id: string) => void;
  onReorderNotes: (ids: string[]) => void;
}

export function NotesPanel({
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onReorderNotes,
}: Props) {
  const { t } = useT();
  const [input, setInput] = useState("");
  const [asTodo, setAsTodo] = useState(false);
  /** Locally expanded notes (view preference, not synced). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Note currently being text-edited (expanded state). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Note currently being dragged (HTML5 DnD). */
  const [dragId, setDragId] = useState<string | null>(null);
  /** Insertion index for the drop indicator (0..notes.length). */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onAddNote(trimmed, asTodo);
    setInput("");
    setAsTodo(false);
  };

  const startEdit = (note: PlayerNote) => {
    setDrafts((prev) => ({ ...prev, [note.id]: note.text }));
    setEditingId(note.id);
  };

  const saveEdit = (note: PlayerNote) => {
    const text = drafts[note.id]?.trim();
    if (text && text !== note.text) onUpdateNote(note.id, { text });
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  // The whole panel is a valid drop zone: compute the insertion index from
  // the pointer's vertical position against each note's midpoint.
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const list = listRef.current;
    if (!list) return;
    const noteEls = Array.from(
      list.querySelectorAll<HTMLElement>(".note"),
    );
    const y = e.clientY;
    let idx = noteEls.length;
    for (let i = 0; i < noteEls.length; i++) {
      const rect = noteEls[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        idx = i;
        break;
      }
    }
    setDropIndex((prev) => (prev === idx ? prev : idx));
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dropIndex === null) return;
    const ids = notes.map((n) => n.id);
    const from = ids.indexOf(dragId);
    if (from < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    // Removing the dragged item shifts later targets left by one.
    const adjusted = from < dropIndex ? dropIndex - 1 : dropIndex;
    if (adjusted !== from) {
      next.splice(adjusted, 0, dragId);
      onReorderNotes(next);
    }
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div
      className="notes-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="notes-list" ref={listRef}>
        {notes.length === 0 && (
          <p className="notes-empty">{t["notes.empty"]}</p>
        )}
        {notes.map((note, i) => {
          const isExpanded = expanded.has(note.id);
          const isEditing = editingId === note.id;
          const dropClass =
            dropIndex === i
              ? " note--drop-before"
              : dropIndex === notes.length && i === notes.length - 1
                ? " note--drop-after"
                : "";
          return (
            <div
              key={note.id}
              className={`note${isExpanded ? " note--expanded" : ""}${
                dragId === note.id ? " note--dragging" : ""
              }${dropClass}`}
              onClick={() => toggleExpanded(note.id)}
            >
              <span
                className="note-drag"
                title={t["notes.drag"]}
                draggable
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(note.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropIndex(null);
                }}
              >
                <svg
                  className="note-drag-icon"
                  width="10"
                  height="15"
                  viewBox="0 0 12 18"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="3" cy="3" r="1.5" />
                  <circle cx="9" cy="3" r="1.5" />
                  <circle cx="3" cy="9" r="1.5" />
                  <circle cx="9" cy="9" r="1.5" />
                  <circle cx="3" cy="15" r="1.5" />
                  <circle cx="9" cy="15" r="1.5" />
                </svg>
              </span>
              <div className="note-body">
                <div
                  className={`note-main${isEditing ? " note-main--editing" : ""}`}
                >
                  {note.todo && (
                    <label
                      className="note-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={note.done}
                        onChange={(e) =>
                          onUpdateNote(note.id, { done: e.target.checked })
                        }
                      />
                    </label>
                  )}
                  {isEditing ? (
                    <textarea
                      className="note-edit"
                      onClick={(e) => e.stopPropagation()}
                      value={drafts[note.id] ?? note.text}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [note.id]: e.target.value,
                        }))
                      }
                      rows={3}
                      maxLength={2000}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`note-text${note.done ? " note-text--done" : ""}${
                        isExpanded ? "" : " note-text--collapsed"
                      }`}
                      title={note.text}
                    >
                      {note.text}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <div className="note-actions">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="note-action note-action--primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEdit(note);
                          }}
                        >
                          {t["notes.save"]}
                        </button>
                        <button
                          type="button"
                          className="note-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                        >
                          {t["notes.cancel"]}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="note-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(note);
                        }}
                      >
                        {t["notes.edit"]}
                      </button>
                    )}
                    <button
                      type="button"
                      className="note-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateNote(note.id, { todo: !note.todo })
                      }}
                    >
                      {note.todo ? t["notes.untodo"] : t["notes.todo"]}
                    </button>
                    <button
                      type="button"
                      className="note-action note-action--danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNote(note.id);
                      }}
                    >
                      {t["notes.delete"]}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="notes-form" onSubmit={handleSubmit}>
        <input
          className="notes-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t["notes.placeholder"]}
          maxLength={2000}
        />
        <label className="notes-todo-toggle">
          <input
            type="checkbox"
            checked={asTodo}
            onChange={(e) => setAsTodo(e.target.checked)}
          />
          {t["notes.todo"]}
        </label>
        <button type="submit" className="notes-add">
          {t["notes.add"]}
        </button>
      </form>
    </div>
  );
}
