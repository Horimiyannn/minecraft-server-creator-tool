import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/utils';

export function Select({
  label,
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-neutral-300">{label}</span>}
      <select
        {...rest}
        className={cn(
          'rounded-md bg-neutral-900 border border-neutral-700 px-3 py-1.5 outline-none focus:border-emerald-500',
          className,
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
