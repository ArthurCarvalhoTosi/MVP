import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { readPhoto } from '@/attachments';
import { useDb } from '@/db/provider';
import { logsQuery, readingsQuery, vehiclesQuery } from '@/db/repo';
import { dossierFileName, dossierHtml, findModel, modelYears, todayISO, ValidationError } from '@/domain';
import { AppText, Button, ChipGroup, FormError, Screen, Section, space } from '@/ui';

export default function Dossier() {
  const db = useDb();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const [vehicle] = useState(() => vehiclesQuery(db).all().find((v) => v.id === vehicleId));
  const [withPhotos, setWithPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!vehicle) return <Redirect href="/" />;
  const hasPhotos = logsQuery(db, vehicle.id)
    .all()
    .some((l) => l.photo);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let pdf: File | undefined;
    try {
      const today = todayISO();
      const model = vehicle.modelRef ? findModel(vehicle.modelRef) : undefined;
      const last = readingsQuery(db, vehicle.id).all().at(-1);
      const logs = logsQuery(db, vehicle.id).all();
      const html = dossierHtml({
        nickname: vehicle.nickname,
        model: model ? `${model.brand} ${model.model} ${model.engine}, ${modelYears(model)}` : null,
        lastReading: last ? { km: last.km, readAt: last.readAt } : null,
        logs: await Promise.all(
          logs.map(async (l) => ({
            name: l.itemName ?? 'Manutenção',
            performedAt: l.performedAt,
            km: l.km,
            costCents: l.costCents,
            brandSpec: l.brandSpec,
            registeredOn: todayISO(new Date(l.createdAt)),
            hasReceipt: l.photo !== null,
            photo: withPhotos && l.photo ? await readPhoto(l.photo) : null,
          })),
        ),
        generatedOn: today,
      });
      pdf = new File((await Print.printToFileAsync({ html })).uri);
      await pdf.move(new File(Paths.cache, `${dossierFileName(vehicle.nickname, today)}.pdf`), { overwrite: true });
      await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Enviar histórico' });
      router.back();
    } catch {
      setError(new ValidationError('Não foi possível gerar o PDF. Tente de novo.'));
    } finally {
      // A plain copy, maybe with receipts (CPF, address): it only lives while the share sheet is open.
      try {
        if (pdf?.exists) pdf.delete();
      } catch {
        // Left in the cache folder, which the system clears; nothing the user can act on.
      }
      setBusy(false);
    }
  };

  return (
    // Button inline, not in the footer: a pinned footer falls below the fold at the half-height detent.
    <Screen scroll>
      <Section title="Histórico em PDF">
        <View style={styles.body}>
          <AppText>
            Um PDF com as trocas registradas, datas, km e valores, para mostrar a quem for comprar o carro. As
            observações não entram.
          </AppText>
          {hasPhotos ? (
            <>
              <ChipGroup
                label="Incluir as fotos dos comprovantes?"
                options={[
                  { label: 'Não', value: false },
                  { label: 'Sim', value: true },
                ]}
                value={withPhotos}
                onChange={setWithPhotos}
              />
              {withPhotos ? (
                <AppText color="inkMuted">
                  Notas fiscais costumam mostrar CPF e endereço. Confira as fotos antes de enviar.
                </AppText>
              ) : null}
            </>
          ) : null}
          <FormError error={error} />
          <Button label="Gerar e enviar PDF" loading={busy} onPress={share} />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
