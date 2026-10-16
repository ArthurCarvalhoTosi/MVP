import { render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { TextField } from '../TextField';

function Controlled({ onChangeText }: { onChangeText: (t: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <TextField
      label="Hodômetro"
      suffix="km"
      value={value}
      onChangeText={(t) => {
        setValue(t);
        onChangeText(t);
      }}
    />
  );
}

describe('TextField', () => {
  it('shows the label and labels the input with it (plus unit)', async () => {
    await render(<TextField label="Hodômetro" suffix="km" value="" onChangeText={jest.fn()} />);

    expect(screen.getByText('Hodômetro', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByLabelText('Hodômetro, km')).toBeOnTheScreen();
  });

  it('calls onChangeText as the user types', async () => {
    const onChangeText = jest.fn();
    await render(<Controlled onChangeText={onChangeText} />);

    await userEvent.setup().type(screen.getByLabelText('Hodômetro, km'), '46250');

    expect(onChangeText).toHaveBeenLastCalledWith('46250');
    expect(screen.getByLabelText('Hodômetro, km')).toHaveDisplayValue('46250');
  });

  it('renders prefix and suffix', async () => {
    await render(<TextField label="Custo" prefix="R$" value="" onChangeText={jest.fn()} />);
    expect(screen.getByText('R$', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByLabelText('Custo, R$')).toBeOnTheScreen();

    await screen.rerender(
      <TextField label="Hodômetro" suffix="km" value="" onChangeText={jest.fn()} />,
    );
    expect(screen.getByText('km', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('shows the error in a polite live region and attaches it to the input', async () => {
    await render(
      <TextField
        label="Hodômetro"
        suffix="km"
        value="10"
        onChangeText={jest.fn()}
        error="Menor que a última leitura"
      />,
    );

    expect(screen.getByText('Menor que a última leitura')).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(screen.getByLabelText('Hodômetro, km')).toHaveProp(
      'accessibilityHint',
      'Menor que a última leitura',
    );
  });

  it('renders no error text without an error', async () => {
    await render(<TextField label="Hodômetro" value="" onChangeText={jest.fn()} error={null} />);
    expect(screen.queryByText('Menor que a última leitura')).not.toBeOnTheScreen();
  });
});
