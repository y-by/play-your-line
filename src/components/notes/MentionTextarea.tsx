import { useRef, useState } from "react";
import type { Member } from "../../lib/notes";
import { openMentionQuery } from "../../lib/notes";

interface Props {
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
  onSubmit?: () => void;
}

/** A textarea where typing "@" offers the project's members; picking one writes "@Name ". */
export function MentionTextarea({ value, onChange, members, rows = 2, placeholder, autoFocus, label, onSubmit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const open = dismissed ? null : openMentionQuery(value.slice(0, cursor));
  const options = open ? members.filter((m) => m.name.toLowerCase().startsWith(open.query.toLowerCase())).slice(0, 6) : [];
  const shown = open && options.length > 0;

  const pick = (m: Member) => {
    if (!open) return;
    const next = `${value.slice(0, open.start)}@${m.name} ${value.slice(cursor)}`;
    const pos = open.start + m.name.length + 2;
    onChange(next);
    setCursor(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        maxLength={2000}
        rows={rows}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.value);
          setCursor(e.target.selectionStart);
          setActive(0);
          setDismissed(false);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (shown) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(options[Math.min(active, options.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(true);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit?.();
        }}
      />
      {shown && (
        <ul className="mention-menu" role="listbox" aria-label="Tag someone">
          {options.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? "mention-opt on" : "mention-opt"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
              >
                @{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
