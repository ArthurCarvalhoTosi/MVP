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

  it('shows a readable hint under the field', async () => {
    await render(
      <TextField label="Hodômetro" value="41000" onChangeText={jest.fn()} hint="Valor estimado. Confira no painel do carro." />,
    );
    expect(screen.getByText('Valor estimado. Confira no painel do carro.')).toBeVisible();
  });

  it('passes length limit and select-on-focus to the input', async () => {
    await render(<TextField label="Hodômetro" value="" onChangeText={jest.fn()} maxLength={9} selectTextOnFocus />);
    const input = screen.getByLabelText('Hodômetro');
    expect(input).toHaveProp('maxLength', 9);
    expect(input).toHaveProp('selectTextOnFocus', true);
  });

  it('hides a password and keeps the keyboard from changing it', async () => {
    await render(<TextField label="Senha" value="segredo1" onChangeText={jest.fn()} secure autoCorrect />);
    const input = screen.getByLabelText('Senha');
    expect(input).toHaveProp('secureTextEntry', true);
    expect(input).toHaveProp('autoCorrect', false);
    expect(input).toHaveProp('autoCapitalize', 'none');
  });

  it('renders no error text without an error', async () => {
    await render(<TextField label="Hodômetro" value="" onChangeText={jest.fn()} error={null} />);
    expect(screen.queryByText('Menor que a última leitura')).not.toBeOnTheScreen();
  });
});
