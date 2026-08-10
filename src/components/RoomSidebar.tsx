import { useState } from "react";
import { useT } from "../i18n/useT";

interface Props {
  children: React.ReactNode;
}

export function RoomSidebar({ children }: Props) {
  // Desktop starts open; on mobile the sidebar is a drawer that starts
  // collapsed so the board keeps the full screen.
  const [open, setOpen] = useState(
    () => !window.matchMedia("(max-width: 800px)").matches,
  );
  const { t } = useT();

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
      <aside
        className={`room-sidebar${open ? "" : " collapsed"}`}
        onClick={open ? undefined : () => setOpen(true)}
      >
        <button
          type="button"
          className="sidebar-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          title={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
          aria-label={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
        >
          {open ? "✕" : "☰"}
        </button>
        <div className="sidebar-inner">{children}</div>
      </aside>
    </>
  );
}
