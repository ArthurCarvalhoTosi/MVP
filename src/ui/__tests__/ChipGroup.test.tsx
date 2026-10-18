import { render, screen, userEvent } from '@testing-library/react-native';
import { ChipGroup } from '../ChipGroup';

const options = [
  { label: '< 500 km', value: 'low' },
  { label: '~1.000 km', value: 'mid' },
  { label: '1.500+ km', value: 'high' },
] as const;

describe('ChipGroup', () => {
  it('shows the question as readable text right before the radiogroup', async () => {
    await render(
      <ChipGroup label="Ritmo mensal" options={options} value={null} onChange={jest.fn()} />,
    );

    // Not hidden from screen readers: VoiceOver has no group label to fall back on.
    const question = screen.getByText('Ritmo mensal');
    expect(question).toBeVisible();
    const [first, group] = question.parent!.children;
    expect(first).toBe(question);
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getAllByRole('radio')[0].parent).toBe(group);
  });

  it('has radios whose checked state follows value', async () => {
    const onChange = jest.fn();
    await render(
      <ChipGroup label="Ritmo mensal" options={options} value="mid" onChange={onChange} />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '~1.000 km' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '< 500 km' })).not.toBeChecked();

    await screen.rerender(
      <ChipGroup label="Ritmo mensal" options={options} value="high" onChange={onChange} />,
    );

    expect(screen.getByRole('radio', { name: '1.500+ km' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '~1.000 km' })).not.toBeChecked();
  });

  it('has nothing checked when value is null', async () => {
    await render(
      <ChipGroup label="Ritmo mensal" options={options} value={null} onChange={jest.fn()} />,
    );

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('calls onChange with the pressed option value', async () => {
    const onChange = jest.fn();
    await render(
      <ChipGroup label="Ritmo mensal" options={options} value={null} onChange={onChange} />,
    );

    await userEvent.setup().press(screen.getByRole('radio', { name: '< 500 km' }));

    expect(onChange).toHaveBeenCalledWith('low');
  });
});
