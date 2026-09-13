'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select } from '@ui';
import { LOADERS } from '@/constants';
import { errorText } from '@/lib/errors';
import type { Loader } from '@/types';
import {
  VersionSelect,
  LoaderBuildSelect,
  AUTO_BUILD,
  useVersions,
} from '@/modules/versions';
import { useCreateServer } from '../hooks';

export function CreateWizard({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [loader, setLoader] = useState<Loader>('vanilla');
  const [versionTouched, setVersionTouched] = useState(false);
  const [version, setVersion] = useState('');
  const [loaderVersion, setLoaderVersion] = useState(AUTO_BUILD);
  const [ramMb, setRamMb] = useState(2048);
  const [port, setPort] = useState(25565);
  const { data: versions } = useVersions(loader);
  const { mutate, isPending, isError, error } = useCreateServer();

  // Default the version to the first available whenever the loader's
  // versions load/change, unless the user has picked one themselves.
  // Derived during render (react.dev's "Adjusting state when a prop
  // changes") instead of an effect, so no setState-in-effect lint issue.
  const effectiveVersion =
    !versionTouched && versions && versions.length > 0 ? versions[0] : version;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutate(
      {
        name,
        loader,
        version: effectiveVersion,
        // Omit rather than send "" so the backend resolves the latest build.
        ...(loaderVersion ? { loaderVersion } : {}),
        ramMb,
        port,
      },
      { onSuccess: (created) => onCreated(created.id) },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Select
        label="Loader"
        value={loader}
        onChange={(e) => {
          setLoader(e.target.value as Loader);
          setVersionTouched(false);
          setLoaderVersion(AUTO_BUILD);
        }}
        options={LOADERS.map((l) => ({ value: l, label: l }))}
      />
      <VersionSelect
        loader={loader}
        value={effectiveVersion}
        onChange={(v) => {
          setVersion(v);
          setVersionTouched(true);
          // Builds are per MC version, so a pinned build can't carry over.
          setLoaderVersion(AUTO_BUILD);
        }}
      />
      <LoaderBuildSelect
        loader={loader}
        mcVersion={effectiveVersion}
        value={loaderVersion}
        onChange={setLoaderVersion}
      />
      <Input
        label="RAM (MB)"
        type="number"
        value={ramMb}
        onChange={(e) => setRamMb(Number(e.target.value))}
        min={512}
        step={512}
      />
      <Input
        label="Port"
        type="number"
        value={port}
        onChange={(e) => setPort(Number(e.target.value))}
        min={1024}
        max={65535}
      />
      {isError && (
        <p role="alert" className="text-sm text-red-400">
          {errorText(error)}
        </p>
      )}
      <Button
        type="submit"
        loading={isPending}
        disabled={!name || !effectiveVersion}
      >
        Create
      </Button>
    </form>
  );
}
