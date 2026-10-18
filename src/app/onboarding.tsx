import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { createVehicle, vehiclesQuery } from '@/db/repo';
import {
  intervalLabel,
  MAX_KM,
  modelYears,
  MONTHLY_KM_OPTIONS,
  parseIntBR,
  PRESETS,
  presetSchedule,
  presetsFor,
  searchModels,
  suggestedNickname,
  todayISO,
  type CarModel,
} from '@/domain';
import { AppText, Button, ChipGroup, FormError, Icon, Screen, Section, TextField, space, radius, useTheme } from '@/ui';

const SEVERE_OPTIONS = [
  { label: 'Sim', value: true },
  { label: 'Não', value: false },
] as const;

type Errors = Partial<Record<'nickname' | 'km' | 'items' | 'form', string>>;

export default function Onboarding() {
  const db = useDb();
  const { c } = useTheme();
  // Read once: an extra car (not the first) is known when the form opens and doesn't change.
  const [adding] = useState(() => vehiclesQuery(db).all().length > 0);
  const [nickname, setNickname] = useState('');
  const [km, setKm] = useState('');
  const [monthly, setMonthly] = useState(1000);
  const [severe, setSevere] = useState(false);
  const [model, setModel] = useState<ModelChoice>(null);
  const [suggestion, setSuggestion] = useState('');
  const [picked, setPicked] = useState(() => PRESETS.map((p) => p.key));
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const chosen = model === 'none' ? undefined : (model ?? undefined);
  const presets = presetsFor(chosen);
  const items = presets.filter((p) => picked.includes(p.key));

  const choose = (next: ModelChoice) => {
    // Only fills a blank name or our own earlier suggestion, never what the user typed.
    if (next && next !== 'none' && (!nickname.trim() || nickname === suggestion)) {
      setNickname(suggestedNickname(next));
      setSuggestion(suggestedNickname(next));
    }
    setModel(next);
  };

  const start = async () => {
    if (saving) return;
    const odometerKm = parseIntBR(km);
    const next: Errors = {
      nickname: nickname.trim() ? undefined : 'Digite um nome para o carro.',
      km:
        odometerKm === null
          ? 'Digite o KM do painel usando só números.'
          : odometerKm > MAX_KM
            ? 'Confira o KM: o valor parece alto demais.'
            : undefined,
      items: items.length ? undefined : 'Marque pelo menos um item para acompanhar.',
    };
    setSaveError(null);
    if (odometerKm === null || next.km || next.nickname || next.items) {
      // Fields above may be scrolled away; this line sits next to the button that was pressed.
      setErrors({ ...next, form: 'Confira os campos destacados acima.' });
      if (next.items) AccessibilityInfo.announceForAccessibility(next.items);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await createVehicle(
        db,
        {
          nickname,
          odometerKm,
          monthlyKmEstimate: monthly,
          severeUse: severe,
          modelRef: chosen?.id ?? null,
          items: items.map((p) => ({
            templateKey: p.key,
            name: p.name,
            ...presetSchedule(p, severe),
          })),
        },
        todayISO(),
      );
      // Back to the garage underneath (another car); on first run the redirect replaced it, and
      // dismissTo then replaces this screen instead. Either way no stale screen stays in the stack.
      router.dismissTo('/'); // stays "saving" while the garage opens
    } catch (e) {
      setSaving(false);
      setSaveError(e);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          {errors.form ? <AppText color="critical">{errors.form}</AppText> : null}
          <FormError error={saveError} />
          <Button label={adding ? 'Adicionar carro' : 'Começar'} loading={saving} onPress={start} />
        </>
      }
    >
      {adding ? <Stack.Screen options={{ title: 'Adicionar carro' }} /> : null}
      <View style={styles.fields}>
        <ModelField model={model} onChange={choose} />
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
          selectTextOnFocus
          maxLength={9}
          value={km}
          onChangeText={setKm}
          error={errors.km}
        />
        <ChipGroup
          label="Quanto você roda por mês?"
          options={MONTHLY_KM_OPTIONS}
          value={monthly}
          onChange={setMonthly}
        />
        <View style={styles.question}>
          <ChipGroup
            label="Usa mais na cidade, com trânsito?"
            options={SEVERE_OPTIONS}
            value={severe}
            onChange={setSevere}
          />
          <AppText variant="caption" color="inkMuted">
            Uso urbano costuma exigir trocas mais frequentes.
          </AppText>
        </View>
      </View>

      <Section title="O que acompanhar">
        {presets.map((p) => {
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

// null while searching; 'none' once the user says the car isn't listed.
type ModelChoice = CarModel | 'none' | null;

function ModelField({ model, onChange }: { model: ModelChoice; onChange: (m: ModelChoice) => void }) {
  const { c } = useTheme();
  const [query, setQuery] = useState('');

  if (model !== null) {
    const m = model === 'none' ? null : model;
    return (
      <View style={[styles.check, { borderBottomColor: c.line }]}>
        <View style={styles.flex}>
          <AppText variant="caption" color="inkMuted">
            Modelo
          </AppText>
          <AppText variant="bodyStrong">{m ? `${m.brand} ${m.model} ${m.engine}` : 'Não está na lista'}</AppText>
          <AppText variant="caption" color="inkMuted">
            {m ? modelYears(m) : 'Depois você preenche óleo, calibragem, palhetas e bateria.'}
          </AppText>
        </View>
        <Button variant="quiet" label="Trocar modelo" onPress={() => onChange(null)} />
      </View>
    );
  }

  const results = searchModels(query);
  return (
    <View>
      <TextField
        label="Qual é o modelo?"
        placeholder="Ex.: Onix, HB20, Strada"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
      />
      <View style={styles.results}>
        {results.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onChange(m)}
            accessibilityRole="button"
            accessibilityLabel={`${m.brand} ${m.model} ${m.engine}, ${modelYears(m)}`}
            style={({ pressed }) => [styles.check, { borderBottomColor: c.line }, pressed && { backgroundColor: c.line }]}
          >
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{`${m.brand} ${m.model}`}</AppText>
              <AppText variant="caption" color="inkMuted">{`${m.engine} · ${modelYears(m)}`}</AppText>
            </View>
            <Icon name="chevron-right" size={20} color={c.inkMuted} />
          </Pressable>
        ))}
      </View>
      {query.trim() && results.length === 0 ? (
        <AppText color="inkMuted" accessibilityLiveRegion="polite">
          Não achamos esse modelo. Confira o nome ou toque em “Meu carro não está na lista”.
        </AppText>
      ) : null}
      <View style={styles.start}>
        <Button variant="quiet" label="Meu carro não está na lista" onPress={() => onChange('none')} />
      </View>
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
  results: { marginTop: space.s },
  start: { alignItems: 'flex-start' },
});
