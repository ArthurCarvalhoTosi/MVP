import { render, screen, userEvent } from '@testing-library/react-native';
import { ItemRow } from '../ItemRow';

const hidden = { includeHiddenElements: true };

describe('ItemRow', () => {
  it('combines name, urgency word and status texts into one accessible label', async () => {
    await render(
      <ItemRow
        name="Troca de óleo"
        urgency="critical"
        primary="Vencido há 12 dias"
        secondary="Faltam 300 km"
      />,
    );

    expect(
      screen.getByLabelText('Troca de óleo. Crítico. Vencido há 12 dias. Faltam 300 km'),
    ).toBeOnTheScreen();
  });

  it('omits a missing secondary from the label', async () => {
    await render(<ItemRow name="Rodízio de pneus" urgency="ok" primary="Em ~4 meses" secondary={null} />);

    expect(screen.getByLabelText('Rodízio de pneus. Em dia. Em ~4 meses')).toBeOnTheScreen();
  });

  it('is a button when onPress is given', async () => {
    const onPress = jest.fn();
    await render(
      <ItemRow name="Freios" urgency="attention" primary="Vence em 30 dias" onPress={onPress} />,
    );

    await userEvent.setup().press(
      screen.getByRole('button', { name: 'Freios. Atenção. Vence em 30 dias' }),
    );

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the action only on critical rows and calls its handler', async () => {
    const onAction = jest.fn();
    const action = { label: 'Registrar troca', onPress: onAction };
    await render(
      <ItemRow name="Troca de óleo" urgency="critical" primary="Vencido" action={action} />,
    );

    await userEvent.setup().press(screen.getByRole('button', { name: 'Registrar troca' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <ItemRow name="Troca de óleo" urgency="attention" primary="Vence em 30 dias" action={action} />,
    );
    expect(screen.queryByRole('button', { name: 'Registrar troca' })).not.toBeOnTheScreen();
  });

  it.each([
    ['critical', 'alert-octagon'],
    ['attention', 'alert'],
    ['ok', 'check-circle-outline'],
  ] as const)('uses a distinct icon shape for %s', async (urgency, icon) => {
    await render(<ItemRow name="Filtro de ar" urgency={urgency} primary="Status" />);

    expect(screen.getByTestId(`icon-${icon}`, hidden)).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^icon-/, hidden)).toHaveLength(1);
  });
});
