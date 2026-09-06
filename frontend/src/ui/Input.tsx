import type { InputHTMLAttributes } from 'react';
import { cn } from '@/utils';

export function Input({
  label,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-neutral-300">{label}</span>}
      <input
        {...rest}
        className={cn(
          'rounded-md bg-neutral-900 border border-neutral-700 px-3 py-1.5 outline-none focus:border-emerald-500',
          className,
        )}
      />
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </label>
  );
}
