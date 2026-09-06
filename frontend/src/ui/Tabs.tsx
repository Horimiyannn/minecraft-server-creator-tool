export function Tabs<K extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { key: K; label: string }[];
  current: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-neutral-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === current}
          onClick={() => onChange(t.key)}
          className={
            t.key === current
              ? 'px-3 py-2 text-sm border-b-2 border-emerald-500 text-white'
              : 'px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200'
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
