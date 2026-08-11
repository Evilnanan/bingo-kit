import { useT } from "../i18n/useT";

interface Props {
  open: boolean;
  onToggle: () => void;
  /** Unread-chat indicator shown on the expand handle while collapsed. */
  unread?: boolean;
  children: React.ReactNode;
}

export function RoomSidebar({ open, onToggle, unread, children }: Props) {
  const { t } = useT();

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onToggle} />}
      <aside
        className={`room-sidebar${open ? "" : " collapsed"}`}
        onClick={open ? undefined : onToggle}
      >
        <button
          type="button"
          className="sidebar-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
          aria-label={open ? t["sidebar.collapse"] : t["sidebar.expand"]}
        >
          {open ? "✕" : "☰"}
          {unread && <span className="sidebar-toggle-dot" aria-hidden="true" />}
        </button>
        <div className="sidebar-inner">{children}</div>
      </aside>
    </>
  );
}
