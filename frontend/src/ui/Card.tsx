import { cn } from '@/utils';

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-800 bg-neutral-900 p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
