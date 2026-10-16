import { render, screen, userEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('exposes the button role and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="Registrar troca" onPress={onPress} />);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Registrar troca' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled and reports the state', async () => {
    const onPress = jest.fn();
    await render(<Button label="Salvar" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Salvar' });

    await userEvent.setup().press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it('does not call onPress while loading and reports busy', async () => {
    const onPress = jest.fn();
    await render(<Button label="Salvar" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Salvar' });

    await userEvent.setup().press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
  });

  it('reports expanded state only when given', async () => {
    await render(<Button label="Em dia (2)" onPress={jest.fn()} expanded={false} />);
    expect(screen.getByRole('button', { name: 'Em dia (2)' })).toBeCollapsed();

    await screen.rerender(<Button label="Em dia (2)" onPress={jest.fn()} expanded />);
    expect(screen.getByRole('button', { name: 'Em dia (2)' })).toBeExpanded();

    await screen.rerender(<Button label="Salvar" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeCollapsed();
  });
});
