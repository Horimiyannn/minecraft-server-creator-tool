import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/utils';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  ghost: 'bg-neutral-800 hover:bg-neutral-700 text-neutral-100',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
