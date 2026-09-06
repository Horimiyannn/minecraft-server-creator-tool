'use client';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@ui';
import { useLogin } from '../hooks';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { mutate, isPending, isError } = useLogin();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutate({ username, password });
  }

  return (
    <Card className="w-80">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {isError && <p className="text-sm text-red-400">Invalid credentials</p>}
        <Button type="submit" loading={isPending}>
          Log in
        </Button>
      </form>
    </Card>
  );
}
