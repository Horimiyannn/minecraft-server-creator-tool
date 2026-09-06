'use client';
import { Select } from '@ui';
import { useVersions } from '../hooks';

export function VersionSelect({
  loader,
  value,
  onChange,
}: {
  loader: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data, isLoading } = useVersions(loader);
  const options = (data ?? []).map((v) => ({ value: v, label: v }));
  return (
    <Select
      label={isLoading ? 'Version (loading…)' : 'Version'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      disabled={isLoading || options.length === 0}
    />
  );
}
