import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('calls onChange with the tab key', async () => {
    const onChange = jest.fn();
    render(
      <Tabs
        tabs={[
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ]}
        current="a"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
