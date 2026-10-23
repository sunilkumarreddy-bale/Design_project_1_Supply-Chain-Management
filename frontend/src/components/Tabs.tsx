export default function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tab${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map((t) => (
        <button key={t.id} type="button" aria-pressed={value === t.id} className={`chip-btn${value === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
