'use client';
import { useEffect, useRef } from 'react';
import { cn } from '@/utils';

/**
 * Dialog built on <dialog>, so the browser supplies the top layer, focus
 * containment and Escape handling rather than us reimplementing them. Escape
 * is intercepted only to route the close through onClose, keeping React state
 * and the element's own open state in step.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault(); // let React own the open state
        onClose();
      }}
      // The dialog fills its own backdrop, so a click outside the panel
      // lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-0 text-neutral-100 backdrop:bg-black/60',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded px-2 text-xl leading-none text-neutral-400 hover:text-neutral-100"
        >
          ×
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
