'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, Input } from '@ui';
import { useConsole } from '../hooks';

export function ConsoleTab({ serverId }: { serverId: string }) {
  const { lines, send, connected } = useConsole(serverId);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenRef = useRef(0);
  const [command, setCommand] = useState('');

  useEffect(() => {
    if (!mountRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: '#0a0a0a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();
    termRef.current = term;
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      writtenRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    for (let i = writtenRef.current; i < lines.length; i++) {
      term.writeln(lines[i]);
    }
    writtenRef.current = lines.length;
  }, [lines]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    send(command);
    setCommand('');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-neutral-500">
        {connected ? 'connected' : 'connecting…'}
      </div>
      <div
        ref={mountRef}
        className="h-96 w-full overflow-hidden rounded-md border border-neutral-800 bg-black p-2"
      />
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          className="flex-1"
          placeholder="Type a command (e.g. list)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <Button type="submit" disabled={!connected}>
          Send
        </Button>
      </form>
    </div>
  );
}
