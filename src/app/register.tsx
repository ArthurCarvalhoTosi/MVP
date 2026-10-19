import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { deleteRemovedPhotos, preparePhoto, readPhoto, saveWithPhoto } from '@/attachments';
import { useDb } from '@/db/provider';
import {
  allItemsQuery,
  logsQuery,
  OdometerError,
  readingsQuery,
  registerMaintenance,
  updateMaintenance,
  vehiclesQuery,
} from '@/db/repo';
import {
  addDays,
  maskBRDate,
  MAX_KM,
  parseBRDate,
  parseBRL,
  parseIntBR,
  projectOdometer,
  READING_ERRORS,
  todayISO,
  ValidationError,
  type ISODate,
} from '@/domain';
import {
  AppText,
  Button,
  ChipGroup,
  FormError,
  Screen,
  Section,
  TextField,
  radius,
  space,
  useTheme,
} from '@/ui';

const DATE_OPTIONS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Ontem', value: 'yesterday' },
  { label: 'Outra data', value: 'other' },
] as const;

type DateChoice = (typeof DATE_OPTIONS)[number]['value'];
type Errors = Partial<Record<'km' | 'date' | 'cost', string>>;

/** Registers a maintenance for `itemId`, or edits the log `logId` of car `vehicleId` (from history). */
export default function Register() {
  const db = useDb();
  const { c } = useTheme();
  const { itemId, logId, vehicleId } = useLocalSearchParams<{
    itemId?: string;
    logId?: string;
    vehicleId?: string;
  }>();
  // Read once: the form only needs starting values, not live updates.
  const [start] = useState(() => {
    const today = todayISO();
    if (logId) {
      const log = logsQuery(db, vehicleId ?? '')
        .all()
        .find((l) => l.id === logId);
      if (!log) return null;
      return {
        vehicleId: log.vehicleId,
        itemId: log.itemId,
        title: log.itemName ?? 'Manutenção',
        log,
        km: log.km,
        date: log.performedAt,
      };
    }
    const item = allItemsQuery(db)
      .all()
      .find((i) => i.id === itemId);
    const vehicle =
      item &&
      vehiclesQuery(db)
        .all()
        .find((v) => v.id === item.vehicleId);
    if (!vehicle || !item) return null;
    const km = projectOdometer(
      readingsQuery(db, vehicle.id).all(),
      vehicle.monthlyKmEstimate,
      today,
    );
    return { vehicleId: vehicle.id, itemId: item.id, title: item.name, log: null, km, date: today };
  });
  const log = start?.log;
  const [km, setKm] = useState(start ? String(start.km) : '');
  const [dateChoice, setDateChoice] = useState<DateChoice>(() =>
    start ? choiceFor(start.date) : 'today',
  );
  const [otherDate, setOtherDate] = useState(() =>
    start && choiceFor(start.date) === 'other' ? toBR(start.date) : '',
  );
  const [cost, setCost] = useState(
    log?.costCents != null ? (log.costCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [brandSpec, setBrandSpec] = useState(log?.brandSpec ?? '');
  const [notes, setNotes] = useState(log?.notes ?? '');
  // Plain JPEGs as base64, in memory only: the one picked here, and the saved one, kept apart so a
  // slow decrypt can't overwrite a newer pick. Until the user picks or removes, the saved one stays.
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<unknown>(null);
  const [picking, setPicking] = useState<'camera' | 'library' | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const savedPhoto = log?.photo ?? null;
  useEffect(() => {
    if (!savedPhoto) return;
    let live = true;
    readPhoto(savedPhoto).then(
      (base64) => live && setSaved(base64),
      () => live && setPhotoError(new ValidationError('Não foi possível abrir a foto salva.')),
    );
    return () => {
      live = false;
    };
  }, [savedPhoto]);

  if (!start) return <Redirect href="/" />;

  const pick = async (source: 'camera' | 'library') => {
    if (picking) return;
    setPhotoError(null);
    setPicking(source);
    try {
      if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setPhotoError(
          new ValidationError(
            'Para fotografar o comprovante, permita o uso da câmera nas configurações do aparelho.',
          ),
        );
        return;
      }
      const launch =
        source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await launch({ mediaTypes: 'images', quality: 1 });
      if (result.canceled) return;
      setPhoto(await preparePhoto(result.assets[0].uri));
      setPhotoChanged(true);
    } catch {
      setPhotoError(new ValidationError('Não foi possível usar essa foto. Tente de novo.'));
    } finally {
      setPicking(null);
    }
  };

  const removePhoto = () => {
    setPhoto(null);
    setPhotoChanged(true);
    setPhotoError(null);
  };

  const save = async () => {
    if (saving || picking) return;
    const today = todayISO();
    const kmValue = parseIntBR(km);
    const performedAt =
      dateChoice === 'today'
        ? today
        : dateChoice === 'yesterday'
          ? addDays(today, -1)
          : parseBRDate(otherDate, today);
    const costCents = cost.trim() ? parseBRL(cost) : null;
    const next: Errors = {
      km:
        kmValue === null
          ? 'Digite o KM do painel usando só números.'
          : kmValue > MAX_KM
            ? 'Confira o KM: o valor parece alto demais.'
            : undefined,
      date: performedAt === null ? 'Use uma data até hoje, no formato DD/MM/AAAA.' : undefined,
      cost:
        cost.trim() && costCents === null
          ? 'Digite o valor em reais, por exemplo 150,00.'
          : undefined,
    };
    setErrors(next);
    setSaveError(null);
    if (kmValue === null || next.km || performedAt === null || next.cost) return;
    setSaving(true);
    try {
      const fields = { performedAt, km: kmValue, costCents, brandSpec, notes };
      if (log) {
        await saveWithPhoto(photoChanged ? photo : undefined, (attachment) =>
          updateMaintenance(db, log.id, { ...fields, attachment }),
        );
        deleteRemovedPhotos(db);
      } else {
        await saveWithPhoto(photo, (attachment) =>
          registerMaintenance(db, {
            ...fields,
            vehicleId: start.vehicleId,
            itemId: start.itemId,
            attachment,
          }),
        );
      }
      router.back(); // stays "saving" while the sheet closes
    } catch (e) {
      setSaving(false);
      if (!(e instanceof OdometerError)) return setSaveError(e);
      // Fixing an earlier reading discards data, so it only happens in Ajustar KM, after a confirmation.
      const fix =
        e.check === 'below_previous'
          ? ' Se o KM salvo antes estava errado, corrija em Ajustar KM.'
          : '';
      setErrors({ km: READING_ERRORS[e.check] + fix });
    }
  };

  const showsPhoto = photoChanged ? photo !== null : savedPhoto !== null;
  const shown = photoChanged ? photo : saved;

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={saveError} />
          <Button
            label={log ? 'Salvar alterações' : 'Registrar troca'}
            loading={saving}
            disabled={picking !== null}
            onPress={save}
          />
        </>
      }
    >
      <Section title={start.title}>
        <View style={styles.fields}>
          <TextField
            label="KM no momento da troca"
            suffix="km"
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={9}
            value={km}
            onChangeText={setKm}
            error={errors.km}
            hint={
              !log && km === String(start.km) ? 'Valor estimado. Confira no painel do carro.' : null
            }
          />
          <ChipGroup
            label="Data da troca"
            options={DATE_OPTIONS}
            value={dateChoice}
            onChange={setDateChoice}
          />
          {dateChoice === 'other' ? (
            <TextField
              label="Data (DD/MM/AAAA)"
              placeholder="15/03/2026"
              // The mask adds the slashes, so the plain number pad (no "/" on Android) is enough.
              keyboardType="number-pad"
              maxLength={10}
              value={otherDate}
              onChangeText={(s) => setOtherDate(maskBRDate(s))}
              error={errors.date}
            />
          ) : null}
          <TextField
            label="Custo (opcional)"
            prefix="R$"
            keyboardType="decimal-pad"
            value={cost}
            onChangeText={setCost}
            error={errors.cost}
          />
          <TextField
            label="Marca ou especificação (opcional)"
            placeholder="Ex.: Mobil 5W-30 sintético"
            value={brandSpec}
            onChangeText={setBrandSpec}
          />
          <TextField
            label="Observações (opcional)"
            placeholder="Ex.: Oficina do bairro"
            value={notes}
            onChangeText={setNotes}
          />
          <View style={styles.photo}>
            <AppText variant="caption" color="inkMuted">
              Foto do comprovante (opcional)
            </AppText>
            {showsPhoto ? (
              <>
                {shown ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${shown}` }}
                    // Decrypted: never into the image cache on disk.
                    cachePolicy="none"
                    contentFit="contain"
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel="Foto do comprovante"
                    style={[styles.preview, { backgroundColor: c.surface, borderColor: c.line }]}
                  />
                ) : photoError ? null : (
                  <AppText color="inkMuted">Abrindo a foto…</AppText>
                )}
                <View style={styles.start}>
                  <Button variant="quiet" label="Remover foto" onPress={removePhoto} />
                </View>
              </>
            ) : (
              <View style={styles.photoButtons}>
                <Button
                  variant="secondary"
                  icon="camera"
                  label="Tirar foto"
                  loading={picking === 'camera'}
                  disabled={picking === 'library'}
                  onPress={() => pick('camera')}
                />
                <Button
                  variant="secondary"
                  icon="image-multiple"
                  label="Escolher da galeria"
                  loading={picking === 'library'}
                  disabled={picking === 'camera'}
                  onPress={() => pick('library')}
                />
              </View>
            )}
            <FormError error={photoError} />
          </View>
        </View>
      </Section>
    </Screen>
  );
}

function choiceFor(d: ISODate): DateChoice {
  const today = todayISO();
  return d === today ? 'today' : d === addDays(today, -1) ? 'yesterday' : 'other';
}

const toBR = (d: ISODate) => d.split('-').reverse().join('/');

const styles = StyleSheet.create({
  fields: { gap: space.xl },
  photo: { gap: space.s },
  photoButtons: { gap: space.s },
  preview: { height: 240, borderWidth: 1, borderRadius: radius.plaque },
  start: { alignItems: 'flex-start' },
});
