import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { createVehicle } from '@/db/repo';
import { intervalLabel, MONTHLY_KM_OPTIONS, parseIntBR, PRESETS, presetSchedule, todayISO } from '@/domain';
import { AppText, Button, ChipGroup, Icon, Screen, Section, TextField, space, radius, useTheme } from '@/ui';

const SEVERE_OPTIONS = [
  { label: 'Sim', value: true },
  { label: 'Não', value: false },
] as const;

type Errors = Partial<Record<'nickname' | 'km' | 'items' | 'form', string>>;

export default function Onboarding() {
  const db = useDb();
  const { c } = useTheme();
  const [nickname, setNickname] = useState('');
  const [km, setKm] = useState('');
  const [monthly, setMonthly] = useState(1000);
  const [severe, setSevere] = useState(false);
  const [picked, setPicked] = useState(() => PRESETS.map((p) => p.key));
  const [errors, setErrors] = useState<Errors>({});

  const start = async () => {
    const odometerKm = parseIntBR(km);
    const next: Errors = {
      nickname: nickname.trim() ? undefined : 'Digite um nome para o carro.',
      km: odometerKm === null ? 'Digite o KM do painel usando só números.' : undefined,
      items: picked.length ? undefined : 'Marque pelo menos um item para acompanhar.',
    };
    if (odometerKm === null || next.nickname || next.items) {
      // Fields above may be scrolled away; this line sits next to the button that was pressed.
      setErrors({ ...next, form: 'Confira os campos destacados acima.' });
      if (next.items) AccessibilityInfo.announceForAccessibility(next.items);
      return;
    }
    try {
      await createVehicle(
        db,
        {
          nickname,
          odometerKm,
          monthlyKmEstimate: monthly,
          severeUse: severe,
          items: PRESETS.filter((p) => picked.includes(p.key)).map((p) => ({
            templateKey: p.key,
            name: p.name,
            ...presetSchedule(p, severe),
          })),
        },
        todayISO(),
      );
      router.replace('/');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrors({ form: message });
      AccessibilityInfo.announceForAccessibility(message);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          {errors.form ? <AppText color="critical">{errors.form}</AppText> : null}
          <Button label="Começar" onPress={start} />
        </>
      }
    >
      <View style={styles.fields}>
        <TextField
          label="Como você chama o carro?"
          placeholder="Meu Sandero 2018"
          value={nickname}
          onChangeText={setNickname}
          error={errors.nickname}
        />
        <TextField
          label="Hodômetro atual"
          suffix="km"
          keyboardType="number-pad"
          value={km}
          onChangeText={setKm}
          error={errors.km}
        />
        <Question label="Quanto você roda por mês?">
          <ChipGroup
            accessibilityLabel="Quanto você roda por mês?"
            options={MONTHLY_KM_OPTIONS}
            value={monthly}
            onChange={setMonthly}
          />
        </Question>
        <Question label="Usa mais na cidade, com trânsito?">
          <ChipGroup
            accessibilityLabel="Usa mais na cidade, com trânsito?"
            options={SEVERE_OPTIONS}
            value={severe}
            onChange={setSevere}
          />
          <AppText variant="caption" color="inkMuted">
            Uso urbano costuma exigir trocas mais frequentes.
          </AppText>
        </Question>
      </View>

      <Section title="O que acompanhar">
        {PRESETS.map((p) => {
          const checked = picked.includes(p.key);
          const s = presetSchedule(p, severe);
          const interval = intervalLabel(s.intervalKm, s.intervalMonths);
          return (
            <Pressable
              key={p.key}
              onPress={() => setPicked(checked ? picked.filter((k) => k !== p.key) : [...picked, p.key])}
              accessibilityRole="checkbox"
              accessibilityLabel={`${p.name}. ${interval}`}
              accessibilityState={{ checked }}
              style={({ pressed }) => [
                styles.check,
                { borderBottomColor: c.line },
                pressed && { backgroundColor: c.line },
              ]}
            >
              <View
                style={[
                  styles.box,
                  // inkMuted keeps the empty box boundary at >= 3:1, like the other controls.
                  { borderColor: checked ? c.primary : c.inkMuted, backgroundColor: checked ? c.primary : c.surface },
                ]}
              >
                {checked ? <Icon name="check" size={18} color={c.onPrimary} /> : null}
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{p.name}</AppText>
                <AppText variant="caption" color="inkMuted">
                  {interval}
                </AppText>
              </View>
            </Pressable>
          );
        })}
        {errors.items ? <AppText color="critical">{errors.items}</AppText> : null}
        <AppText color="inkMuted" style={styles.note}>
          As contagens começam hoje. Você ajusta depois, ao registrar cada troca.
        </AppText>
      </Section>
    </Screen>
  );
}

// Visible label for a chip group; screen readers get it from the group's own label.
function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.question}>
      <AppText variant="caption" color="inkMuted" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: space.xl, marginBottom: space.xxl },
  question: { gap: space.s },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 48,
    paddingVertical: space.m,
    borderBottomWidth: 1,
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderRadius: radius.drum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  note: { marginTop: space.m },
});
