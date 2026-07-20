import { useState } from "react";
import { useT } from "../i18n/useT";

interface Props {
  children: React.ReactNode;
}

export function RoomSidebar({ children }: Props) {
  const [open, setOpen] = useState(true);
  const { t } = useT();

  return (
    <aside className={`room-sidebar${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setOpen((v) => !v)}
        title={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
        aria-label={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
      >
        {open ? "✕" : "☰"}
      </button>
      <div className="sidebar-inner">{children}</div>
    </aside>
  );
}
