'use client';

export function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const parts = path.split('/').filter(Boolean);
  return (
    <nav className="flex items-center gap-1 text-sm text-neutral-400">
      <button
        type="button"
        onClick={() => onNavigate('')}
        className="hover:text-white"
      >
        data
      </button>
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="flex items-center gap-1">
          <span>/</span>
          <button
            type="button"
            className="hover:text-white"
            onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}
          >
            {part}
          </button>
        </span>
      ))}
    </nav>
  );
}
