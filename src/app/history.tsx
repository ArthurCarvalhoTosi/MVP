import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { deleteRemovedPhotos, readPhoto } from '@/attachments';
import { useDb } from '@/db/provider';
import { logsQuery, removeMaintenance, vehiclesQuery } from '@/db/repo';
import { formatBRL, formatDate, formatKm, todayISO, ValidationError } from '@/domain';
import {
  AppText,
  Button,
  FormError,
  Icon,
  Screen,
  Section,
  radius,
  space,
  useTheme,
  type IconName,
} from '@/ui';

type Log = ReturnType<ReturnType<typeof logsQuery>['all']>[number];

export default function History() {
  const db = useDb();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const [vehicle] = useState(() =>
    vehiclesQuery(db)
      .all()
      .find((v) => v.id === vehicleId),
  );
  const logs = useLiveQuery(logsQuery(db, vehicle?.id ?? ''), [vehicle?.id]);
  const [error, setError] = useState<unknown>(null);

  if (!vehicle) return <Redirect href="/" />;
  if (logs.error) throw logs.error;
  if (!logs.updatedAt) return null;

  if (logs.data.length === 0) {
    return (
      <Screen>
        <View style={styles.empty}>
          <AppText>
            Nenhuma troca registrada ainda. Quando você registrar a primeira, ela aparece aqui.
          </AppText>
          <Button
            variant="secondary"
            label="Voltar para a garagem"
            onPress={() => router.dismissTo('/')}
          />
        </View>
      </Screen>
    );
  }

  const total = logs.data.reduce((sum, l) => sum + (l.costCents ?? 0), 0);
  const count = logs.data.length;

  const edit = (log: Log) =>
    router.push({ pathname: '/register', params: { vehicleId: vehicle.id, logId: log.id } });

  const remove = (log: Log) => {
    const gone = log.photo
      ? 'O registro e a foto do comprovante serão apagados deste aparelho.'
      : 'O registro será apagado deste aparelho.';
    Alert.alert(
      'Excluir esta troca?',
      `${nameOf(log)}, ${formatDate(log.performedAt)}. ${gone} Isso não pode ser desfeito.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            try {
              await removeMaintenance(db, log.id);
              deleteRemovedPhotos(db);
            } catch (e) {
              setError(e);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen
      scroll
      footer={
        <Button
          label="Exportar histórico em PDF"
          onPress={() => router.push({ pathname: '/dossier', params: { vehicleId: vehicle.id } })}
        />
      }
    >
      <View style={styles.total} accessible>
        <AppText variant="caption" color="inkMuted">
          Total gasto em manutenção
        </AppText>
        <AppText variant="number">{formatBRL(total)}</AppText>
        <AppText color="inkMuted">
          {count === 1 ? '1 troca registrada' : `${count} trocas registradas`}
        </AppText>
      </View>

      <Section title="Trocas">
        <FormError error={error} />
        {logs.data.map((log) => (
          // Keyed on the photo too: a replaced photo starts closed instead of showing the old one.
          <LogRow
            key={`${log.id}:${log.photo}`}
            log={log}
            onEdit={() => edit(log)}
            onRemove={() => remove(log)}
          />
        ))}
      </Section>
    </Screen>
  );
}

const nameOf = (log: Log) => log.itemName ?? 'Manutenção';

function LogRow({ log, onEdit, onRemove }: { log: Log; onEdit: () => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  // Decrypted photo, in memory only while this row is on screen.
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<unknown>(null);
  // createdAt is a UTC timestamp; compare its local calendar day with the service date.
  const registeredOn = todayISO(new Date(log.createdAt));
  const what = `${nameOf(log)} de ${formatDate(log.performedAt)}`;

  const togglePhoto = async () => {
    if (open || !log.photo) return setOpen(false);
    setOpen(true);
    if (photo) return;
    setPhotoError(null);
    try {
      setPhoto(await readPhoto(log.photo));
    } catch {
      setPhotoError(new ValidationError('Não foi possível abrir a foto. Tente de novo.'));
    }
  };

  return (
    <View style={[styles.row, { borderBottomColor: c.line }]}>
      <View style={styles.main}>
        <View accessible style={styles.info}>
          <AppText variant="bodyStrong">{nameOf(log)}</AppText>
          <AppText>{`${formatDate(log.performedAt)} · ${formatKm(log.km)}`}</AppText>
          {log.costCents != null ? (
            <AppText variant="number">{formatBRL(log.costCents)}</AppText>
          ) : null}
          {log.brandSpec ? <AppText color="inkMuted">{log.brandSpec}</AppText> : null}
          {log.notes ? <AppText color="inkMuted">{log.notes}</AppText> : null}
          {registeredOn !== log.performedAt ? (
            <AppText variant="caption" color="inkMuted">
              {`Registrado em ${formatDate(registeredOn)}`}
            </AppText>
          ) : null}
          {log.photo ? (
            <AppText variant="caption" color="inkMuted">
              Com comprovante
            </AppText>
          ) : null}
        </View>
        <IconButton icon="pencil" label={`Editar ${what}`} onPress={onEdit} />
        <IconButton icon="trash-can-outline" label={`Excluir ${what}`} onPress={onRemove} />
      </View>
      {log.photo ? (
        <View style={styles.start}>
          <Button
            variant="quiet"
            label={open ? 'Ocultar foto' : 'Ver foto'}
            accessibilityLabel={`${open ? 'Ocultar' : 'Ver'} foto do comprovante de ${what}`}
            expanded={open}
            onPress={togglePhoto}
          />
        </View>
      ) : null}
      {open ? (
        photo ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${photo}` }}
            // Decrypted: never into the image cache on disk.
            cachePolicy="none"
            contentFit="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Foto do comprovante de ${what}`}
            style={[styles.photo, { backgroundColor: c.surface, borderColor: c.line }]}
          />
        ) : photoError ? (
          <FormError error={photoError} />
        ) : (
          <AppText color="inkMuted">Abrindo a foto…</AppText>
        )
      ) : null}
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: c.line }]}
    >
      <Icon name={icon} size={24} color={c.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { gap: space.xl },
  total: { gap: space.xs, marginBottom: space.xxl },
  row: { gap: space.xs, paddingVertical: space.m, borderBottomWidth: 1 },
  main: { flexDirection: 'row', alignItems: 'flex-start' },
  info: { flex: 1, gap: space.xs },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  start: { alignItems: 'flex-start' },
  photo: { height: 320, borderWidth: 1, borderRadius: radius.plaque },
});
