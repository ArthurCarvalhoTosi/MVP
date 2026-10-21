import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import { useAccount } from '@/account';
import { readPhoto } from '@/attachments';
import type { Db } from '@/db/client';
import { useDb } from '@/db/provider';
import { logsQuery, readingsQuery, vehiclesQuery } from '@/db/repo';
import {
  createDossierLink,
  deleteDossierLink,
  type DossierLink,
  listDossierLinks,
} from '@/dossier-link';
import {
  dossierFileName,
  dossierHtml,
  findModel,
  formatDate,
  modelYears,
  todayISO,
  ValidationError,
} from '@/domain';
import { AppText, Button, ChipGroup, FormError, Screen, Section, space } from '@/ui';

const VALIDITY = [
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 },
  { label: 'Sem prazo', value: 0 },
] as const;

const dayOf = (timestamp: string) => formatDate(todayISO(new Date(timestamp)));

const loadLinks = (db: Db, vehicleId: string, set: (links: DossierLink[] | 'failed') => void) =>
  listDossierLinks(db, vehicleId).then(set, () => set('failed'));

export default function Dossier() {
  const db = useDb();
  const account = useAccount(db);
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const [vehicle] = useState(() =>
    vehiclesQuery(db)
      .all()
      .find((v) => v.id === vehicleId),
  );
  const [withPhotos, setWithPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validity, setValidity] = useState<number>(30);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<unknown>(null);
  const [links, setLinks] = useState<DossierLink[] | 'failed' | null>(null);

  const signedIn = account.status === 'signed-in';
  useEffect(() => {
    if (signedIn && vehicle) loadLinks(db, vehicle.id, setLinks);
  }, [db, signedIn, vehicle]);

  if (!vehicle) return <Redirect href="/" />;
  const refreshLinks = () => loadLinks(db, vehicle.id, setLinks);
  const hasPhotos = logsQuery(db, vehicle.id)
    .all()
    .some((l) => l.photo);

  const buildHtml = async (photos: boolean) => {
    const model = vehicle.modelRef ? findModel(vehicle.modelRef) : undefined;
    const last = readingsQuery(db, vehicle.id).all().at(-1);
    const logs = logsQuery(db, vehicle.id).all();
    return dossierHtml({
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
          photo: photos && l.photo ? await readPhoto(l.photo) : null,
        })),
      ),
      generatedOn: todayISO(),
    });
  };

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let pdf: File | undefined;
    try {
      const html = await buildHtml(withPhotos);
      pdf = new File((await Print.printToFileAsync({ html })).uri);
      await pdf.move(
        new File(Paths.cache, `${dossierFileName(vehicle.nickname, todayISO())}.pdf`),
        { overwrite: true },
      );
      await Sharing.shareAsync(pdf.uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Enviar histórico',
      });
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

  const createLink = async () => {
    if (linking) return;
    setLinking(true);
    setLinkError(null);
    try {
      // Photos stay out of the link: receipts show CPF and address, and a link gets forwarded.
      const expiresAt = validity
        ? new Date(Date.now() + validity * 86_400_000).toISOString()
        : null;
      const url = await createDossierLink(db, vehicle.id, await buildHtml(false), expiresAt);
      refreshLinks();
      await Share.share({ message: `Histórico de manutenção: ${vehicle.nickname}\n${url}` });
    } catch {
      setLinkError(
        new ValidationError('Não foi possível criar o link. Confira a internet e tente de novo.'),
      );
    } finally {
      setLinking(false);
    }
  };

  const deactivate = (link: DossierLink) =>
    Alert.alert(
      'Desativar este link?',
      'Quem recebeu o link não vai mais conseguir abrir o histórico.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desativar',
          style: 'destructive',
          onPress: async () => {
            setLinkError(null);
            try {
              await deleteDossierLink(db, link.id);
              refreshLinks();
            } catch {
              setLinkError(
                new ValidationError(
                  'Não foi possível desativar o link. Confira a internet e tente de novo.',
                ),
              );
            }
          },
        },
      ],
    );

  return (
    // Buttons inline, not in the footer: a pinned footer falls below the fold at the half-height detent.
    <Screen scroll>
      <Section title="Histórico em PDF">
        <View style={styles.body}>
          <AppText>
            Um PDF com as trocas registradas, datas, km e valores, para mostrar a quem for comprar o
            carro. As observações não entram.
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

      {account.status === 'loading' ? null : (
        <Section title="Link do histórico">
          <View style={styles.body}>
            <AppText>
              Um link que abre o mesmo histórico no navegador, sem as fotos. Edições feitas depois
              não mudam um link já enviado.
            </AppText>
            {signedIn ? (
              <>
                <AppText color="inkMuted">
                  O histórico vai cifrado e só abre com o link: nem nós conseguimos ler.
                </AppText>
                <ChipGroup
                  label="Por quanto tempo o link funciona?"
                  options={VALIDITY}
                  value={validity}
                  onChange={setValidity}
                />
                <FormError error={linkError} />
                <Button
                  variant="secondary"
                  label="Criar e enviar link"
                  loading={linking}
                  onPress={createLink}
                />
                {links === 'failed' ? (
                  <AppText color="inkMuted">
                    Não foi possível carregar os links ativos agora.
                  </AppText>
                ) : links?.length ? (
                  <View style={styles.links}>
                    <AppText variant="bodyStrong">Links ativos</AppText>
                    {links.map((l) => {
                      const line = `Criado em ${dayOf(l.createdAt)}, ${
                        l.expiresAt ? `funciona até ${dayOf(l.expiresAt)}` : 'sem prazo'
                      }`;
                      return (
                        <View key={l.id} style={styles.link}>
                          <AppText style={styles.linkText}>{line}</AppText>
                          <Button
                            variant="quiet"
                            label="Desativar"
                            accessibilityLabel={`Desativar link. ${line}`}
                            onPress={() => deactivate(l)}
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <AppText color="inkMuted">Para criar um link, entre na sua conta.</AppText>
                <Button
                  variant="secondary"
                  label="Entrar na conta"
                  onPress={() => router.replace('/account')}
                />
              </>
            )}
          </View>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
  links: { gap: space.s },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  linkText: { flex: 1 },
});
