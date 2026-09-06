'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/constants';
import { Spinner } from '@ui';
import { AppNav } from '@components';
import { useMe } from '@/modules/auth';

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();

  useEffect(() => {
    if (isError) router.replace(ROUTES.login);
  }, [isError, router]);

  if (isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  if (!data) return null;

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="p-6">{children}</main>
    </div>
  );
}
