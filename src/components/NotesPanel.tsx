import { useEffect, useRef, useState } from "react";
import type { GoalItem, PlayerNote } from "../types";
import { getGoalText } from "../types";
import { useT, format } from "../i18n/useT";
import "./NotesPanel.css";

interface Props {
  notes: PlayerNote[];
  onAddNote: (text: string, todo: boolean) => void;
  onUpdateNote: (
    id: string,
    patch: {
      text?: string;
      todo?: boolean;
      done?: boolean;
      linkedCells?: number[] | null;
    },
  ) => void;
  onDeleteNote: (id: string) => void;
  onReorderNotes: (ids: string[]) => void;
  /** Todo currently being linked to board cells (null = not linking). */
  linkingNoteId: string | null;
  onStartLinking: (noteId: string) => void;
  onStopLinking: () => void;
  /** Whether board cells can be picked right now (board visible & playing). */
  linkingEnabled: boolean;
  /** Board goals used to display linked cell text. */
  goals: GoalItem[];
}

export function NotesPanel({
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onReorderNotes,
  linkingNoteId,
  onStartLinking,
  onStopLinking,
  linkingEnabled,
  goals,
}: Props) {
  const { t, lang } = useT();
  const [input, setInput] = useState("");
  const [asTodo, setAsTodo] = useState(false);
  /** Locally expanded notes (view preference, not synced). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Note currently being text-edited (expanded state). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Note currently being dragged (pointer-based drag), null when idle. */
  const [dragId, setDragId] = useState<string | null>(null);
  /** Insertion index for the drop indicator (0..notes.length). */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Active drag session; null when idle. `moved` flips once the pointer
   *  leaves the click slop, distinguishing real drags from plain clicks. */
  const dragSessionRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  /** Mirrors the dropIndex state so pointerup can commit synchronously. */
  const dropIndexRef = useRef<number | null>(null);
  /** Suppresses the click that follows a completed drag (else the note
   *  row would toggle its expansion). */
  const suppressClickRef = useRef(false);
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  });
  const onReorderRef = useRef(onReorderNotes);
  useEffect(() => {
    onReorderRef.current = onReorderNotes;
  });

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

  /** One line per linked cell (prefix is rendered separately once). */
  const linkedLines = (note: PlayerNote): string[] => {
    const cells = note.linkedCells ?? [];
    return cells.map((i) =>
      i >= 0 && i < goals.length
        ? getGoalText(goals[i], lang)
        : format(t["notes.cell"], i),
    );
  };

  // ── pointer-based drag sorting ────────────────────────────────────
  // Pointer Events instead of HTML5 DnD: a native drag session swallows
  // all input (including the wheel), while a pointer-based session leaves
  // wheel scrolling alone so the list keeps scrolling mid-drag.

  /** Map the pointer Y to an insertion index using each note's midpoint,
   *  or null while the pointer is outside the list. */
  function computeDropIndex(clientY: number): number | null {
    const list = listRef.current;
    if (!list) return null;
    const rect = list.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) return null;
    const noteEls = Array.from(list.querySelectorAll<HTMLElement>(".note"));
    let idx = noteEls.length;
    for (let i = 0; i < noteEls.length; i++) {
      const r = noteEls[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  /** Per-frame drag work: edge auto-scroll + drop-indicator refresh. The
   *  indicator is recomputed every frame (not just on pointermove), so it
   *  stays accurate when the wheel scrolls the list mid-drag. */
  function dragTick() {
    dragRafRef.current = null;
    const session = dragSessionRef.current;
    if (!session) return;
    const list = listRef.current;
    if (list) {
      const rect = list.getBoundingClientRect();
      const edge = 48;
      if (session.lastY < rect.top + edge) list.scrollTop -= 16;
      else if (session.lastY > rect.bottom - edge) list.scrollTop += 16;
      const idx = computeDropIndex(session.lastY);
      if (dropIndexRef.current !== idx) {
        dropIndexRef.current = idx;
        setDropIndex(idx);
      }
    }
    dragRafRef.current = requestAnimationFrame(dragTick);
  }

  function endDragSession(commit: boolean) {
    const session = dragSessionRef.current;
    if (!session) return;
    dragSessionRef.current = null;
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
    window.removeEventListener("keydown", onWindowKeyDown);
    window.removeEventListener("blur", onWindowBlur);
    document.body.classList.remove("dnd-dragging");
    if (commit && session.moved && dropIndexRef.current !== null) {
      const ids = notesRef.current.map((n) => n.id);
      const from = ids.indexOf(session.id);
      if (from >= 0) {
        const next = [...ids];
        next.splice(from, 1);
        // Removing the dragged item shifts later targets left by one.
        const adjusted =
          from < dropIndexRef.current
            ? dropIndexRef.current - 1
            : dropIndexRef.current;
        if (adjusted !== from) {
          next.splice(adjusted, 0, session.id);
          onReorderRef.current(next);
        }
      }
    }
    dropIndexRef.current = null;
    setDragId(null);
    setDropIndex(null);
  }

  function onWindowPointerMove(e: PointerEvent) {
    const session = dragSessionRef.current;
    if (!session) return;
    session.lastY = e.clientY;
    if (!session.moved) {
      // Click slop: a plain click on a note must still toggle expansion.
      if (
        Math.hypot(e.clientX - session.startX, e.clientY - session.startY) < 4
      ) {
        return;
      }
      session.moved = true;
      setDragId(session.id);
      dragRafRef.current = requestAnimationFrame(dragTick);
    }
  }

  function onWindowPointerUp() {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.moved) suppressClickRef.current = true;
    endDragSession(true);
  }

  function onWindowPointerCancel() {
    suppressClickRef.current = true;
    endDragSession(false);
  }

  function onWindowKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") endDragSession(false);
  }

  function onWindowBlur() {
    endDragSession(false);
  }

  /** Start a drag session from the note handle's pointerdown. */
  function handleDragHandlePointerDown(id: string, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragSessionRef.current) return;
    suppressClickRef.current = false;
    dragSessionRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      moved: false,
    };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("blur", onWindowBlur);
    document.body.classList.add("dnd-dragging");
  }

  // While a drag session is active, swallow stray pointer downs so they
  // can't steal focus or trigger note interactions mid-drag.
  useEffect(() => {
    if (dragId === null) return;
    const swallow = (e: PointerEvent) => e.preventDefault();
    window.addEventListener("pointerdown", swallow, true);
    return () => window.removeEventListener("pointerdown", swallow, true);
  }, [dragId]);

  return (
    <div className="notes-panel">
      {linkingNoteId && (
        <div className="notes-linking-banner">
          <span>{t["notes.linkingHint"]}</span>
          <button
            type="button"
            className="notes-linking-done"
            onClick={onStopLinking}
          >
            {t["notes.exitLinking"]}
          </button>
        </div>
      )}
      <div className="notes-list" ref={listRef}>
        {notes.length === 0 && (
          <p className="notes-empty">{t["notes.empty"]}</p>
        )}
        {notes.map((note, i) => {
          const isExpanded = expanded.has(note.id);
          const isEditing = editingId === note.id;
          const linkedTexts = note.todo ? linkedLines(note) : [];
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
              }${linkingNoteId === note.id ? " note--linking" : ""}${dropClass}`}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                toggleExpanded(note.id);
              }}
            >
              <span
                className="note-drag"
                title={t["notes.drag"]}
                onPointerDown={(e) => handleDragHandlePointerDown(note.id, e)}
                onClick={(e) => e.stopPropagation()}
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
                    {note.todo && linkingEnabled && (
                      <button
                        type="button"
                        className="note-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Clicking again while this note is being linked
                          // acts like "exit selection".
                          if (linkingNoteId === note.id) {
                            onStopLinking();
                          } else {
                            onStartLinking(note.id);
                          }
                        }}
                      >
                        {t["notes.linkGoals"]}
                      </button>
                    )}
                    <button
                      type="button"
                      className="note-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateNote(note.id, { todo: !note.todo });
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
                    {linkedTexts.length > 0 && (
                      <div
                        className="note-linked"
                        title={linkedTexts.join("\n")}
                      >
                        <span className="note-linked-label">
                          {t["notes.linkedPrefix"]}
                        </span>
                        {linkedTexts.map((line, i) => (
                          <div key={i} className="note-linked-line">
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
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
