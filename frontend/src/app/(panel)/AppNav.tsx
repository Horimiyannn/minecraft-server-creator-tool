'use client';
import Link from 'next/link';
import { ROUTES } from '@/constants';
import { Button } from '@ui';
import { useLogout, useMe } from '@/modules/auth';

export function AppNav() {
  const { data: me } = useMe();
  const { mutate: logout, isPending } = useLogout();
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
      <Link href={ROUTES.dashboard} className="font-semibold">
        mc-panel
      </Link>
      <div className="flex items-center gap-3 text-sm text-neutral-400">
        {me && <span>{me.username}</span>}
        <Button variant="ghost" onClick={() => logout()} loading={isPending}>
          Log out
        </Button>
      </div>
    </header>
  );
}
