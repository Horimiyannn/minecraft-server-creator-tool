import { cn } from './cn';

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
