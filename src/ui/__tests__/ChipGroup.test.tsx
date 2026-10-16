import { render, screen, userEvent } from '@testing-library/react-native';
import { ChipGroup } from '../ChipGroup';

const options = [
  { label: '< 500 km', value: 'low' },
  { label: '~1.000 km', value: 'mid' },
  { label: '1.500+ km', value: 'high' },
] as const;

describe('ChipGroup', () => {
  it('is a radiogroup of radios whose checked state follows value', async () => {
    const onChange = jest.fn();
    await render(
      <ChipGroup options={options} value="mid" onChange={onChange} accessibilityLabel="Ritmo mensal" />,
    );

    expect(screen.getByLabelText('Ritmo mensal')).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '~1.000 km' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '< 500 km' })).not.toBeChecked();

    await screen.rerender(
      <ChipGroup options={options} value="high" onChange={onChange} accessibilityLabel="Ritmo mensal" />,
    );

    expect(screen.getByRole('radio', { name: '1.500+ km' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '~1.000 km' })).not.toBeChecked();
  });

  it('has nothing checked when value is null', async () => {
    await render(<ChipGroup options={options} value={null} onChange={jest.fn()} />);

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('calls onChange with the pressed option value', async () => {
    const onChange = jest.fn();
    await render(<ChipGroup options={options} value={null} onChange={onChange} />);

    await userEvent.setup().press(screen.getByRole('radio', { name: '< 500 km' }));

    expect(onChange).toHaveBeenCalledWith('low');
  });
});
