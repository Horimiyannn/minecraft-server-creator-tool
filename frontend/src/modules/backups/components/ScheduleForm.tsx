'use client';
import { useState } from 'react';
import { Button, Checkbox, Input, Select } from '@ui';
import { errorText } from '@/lib/errors';
import type { BackupSchedule } from '@/types';
import { useSaveBackupSchedule } from '../hooks';

const MAX_KEEP = 20;
const MIN_MINUTES = 5;
type Unit = 'minutes' | 'hours';
const UNITS = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
];

/** Minutes → the largest whole unit that still divides evenly. */
function split(minutes: number | null): { value: number; unit: Unit } {
  if (!minutes) return { value: 0, unit: 'minutes' };
  return minutes % 60 === 0
    ? { value: minutes / 60, unit: 'hours' }
    : { value: minutes, unit: 'minutes' };
}

function toMinutes(value: number, unit: Unit): number | null {
  if (!value) return null;
  return unit === 'hours' ? value * 60 : value;
}

export function ScheduleForm({
  serverId,
  schedule,
}: {
  serverId: string;
  schedule: BackupSchedule;
}) {
  const world = split(schedule.worldEveryMin);
  const full = split(schedule.fullEveryMin);
  const [worldValue, setWorldValue] = useState(world.value);
  const [worldUnit, setWorldUnit] = useState<Unit>(world.unit);
  const [fullValue, setFullValue] = useState(full.value);
  const [fullUnit, setFullUnit] = useState<Unit>(full.unit);
  const [keepWorld, setKeepWorld] = useState(schedule.keepWorld);
  const [keepFull, setKeepFull] = useState(schedule.keepFull);
  const [skipWhenEmpty, setSkipWhenEmpty] = useState(schedule.skipWhenEmpty);
  const [chatEnabled, setChatEnabled] = useState(schedule.chatEnabled);
  const save = useSaveBackupSchedule(serverId);

  const clampKeep = (value: number) =>
    Math.min(MAX_KEEP, Math.max(1, Math.round(value) || 1));
  const floorInterval = (minutes: number | null) =>
    minutes && minutes < MIN_MINUTES ? MIN_MINUTES : minutes;

  function submit(): void {
    save.mutate({
      worldEveryMin: floorInterval(toMinutes(worldValue, worldUnit)),
      fullEveryMin: floorInterval(toMinutes(fullValue, fullUnit)),
      keepWorld: clampKeep(keepWorld),
      keepFull: clampKeep(keepFull),
      skipWhenEmpty,
      chatEnabled,
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-800 p-4">
      <h3 className="font-semibold">Schedule</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="number"
          label="World every"
          min={0}
          value={worldValue}
          onChange={(e) => setWorldValue(Number(e.target.value))}
        />
        <Select
          label="World unit"
          options={UNITS}
          value={worldUnit}
          onChange={(e) => setWorldUnit(e.target.value as Unit)}
        />
        <Input
          type="number"
          label="Full every"
          min={0}
          value={fullValue}
          onChange={(e) => setFullValue(Number(e.target.value))}
        />
        <Select
          label="Full unit"
          options={UNITS}
          value={fullUnit}
          onChange={(e) => setFullUnit(e.target.value as Unit)}
        />
      </div>
      <p className="text-xs text-neutral-500">
        0 turns that schedule off. Minimum interval is 5 minutes.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="number"
          label="Keep world backups"
          min={1}
          max={MAX_KEEP}
          value={keepWorld}
          onChange={(e) => setKeepWorld(Number(e.target.value))}
        />
        <Input
          type="number"
          label="Keep full backups"
          min={1}
          max={MAX_KEEP}
          value={keepFull}
          onChange={(e) => setKeepFull(Number(e.target.value))}
        />
      </div>
      <Checkbox
        checked={skipWhenEmpty}
        onChange={setSkipWhenEmpty}
        label="Skip scheduled backups while nobody has played since the last one"
      />
      <Checkbox
        checked={chatEnabled}
        onChange={setChatEnabled}
        label="Allow !backup in chat (server ops only, world snapshots only)"
      />
      <div>
        <Button onClick={submit} disabled={save.isPending}>
          Save schedule
        </Button>
      </div>
      {save.isError && <p className="text-red-400">{errorText(save.error)}</p>}
    </div>
  );
}
