import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { Keyboard, StyleSheet, Text } from 'react-native';
import { Screen } from '../Screen';

describe('Screen', () => {
  it('lifts content and footer by the part of the screen the keyboard covers, counting the header', async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation((type, listener) => {
      listeners[type] = listener as (e: unknown) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
    });

    await render(
      <HeaderHeightContext.Provider value={100}>
        <Screen footer={<Text>Salvar</Text>}>
          <Text>Campo</Text>
        </Screen>
      </HeaderHeightContext.Provider>,
    );
    const avoider = screen.getByText('Salvar').parent!.parent!;
    expect(avoider).toContainElement(screen.getByText('Campo'));

    // 700 tall below a 100 header, so its bottom is at 800; a keyboard from 500 down covers 300.
    await fireEvent.layout(avoider, { x: 0, y: 0, width: 390, height: 700 });
    await act(async () => {
      listeners.keyboardWillShow({
        endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 344 },
      });
    });

    expect(StyleSheet.flatten(avoider.props.style)).toMatchObject({ paddingBottom: 300 });
    jest.restoreAllMocks();
  });
});
