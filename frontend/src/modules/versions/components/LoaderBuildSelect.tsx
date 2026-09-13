'use client';
import { Select } from '@ui';
import { useLoaderBuilds } from '../hooks';

/** Sentinel for "don't pin a build" — itzg resolves the latest itself. */
export const AUTO_BUILD = '';

export function LoaderBuildSelect({
  loader,
  mcVersion,
  value,
  onChange,
}: {
  loader: string;
  mcVersion: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data, isLoading } = useLoaderBuilds(loader, mcVersion);
  // Vanilla ships no loader, so there is nothing to choose.
  if (loader === 'vanilla') return null;

  const label = `${loader} build`;
  const options = [
    { value: AUTO_BUILD, label: 'Latest (auto)' },
    ...(data ?? []).map((b) => ({ value: b, label: b })),
  ];
  return (
    <Select
      label={isLoading ? `${label} (loading…)` : label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      disabled={isLoading}
    />
  );
}
