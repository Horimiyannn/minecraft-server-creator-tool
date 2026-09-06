type Tone = 'green' | 'gray' | 'red' | 'yellow';
const tones: Record<Tone, string> = {
  green: 'bg-emerald-900 text-emerald-300',
  gray: 'bg-neutral-800 text-neutral-300',
  red: 'bg-red-900 text-red-300',
  yellow: 'bg-yellow-900 text-yellow-300',
};
export function Badge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
