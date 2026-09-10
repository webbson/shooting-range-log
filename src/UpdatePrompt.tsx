import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAppStore } from './store';

/** How often the running app re-checks GitHub for a new release. The laptop
 *  often stays up for a whole shift, so a launch-only check can sit on an old
 *  version for days. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Updater: checks GitHub releases at startup and every few hours while running,
// and asks the operator before downloading. A check must never block or nag —
// failures (offline laptop, GitHub unreachable) are logged and swallowed, and
// only the launch check opens the modal by itself. Later finds just light up
// the menu dot and the drawer's "update now" button.
export function UpdatePrompt() {
  const { t } = useTranslation();
  const update = useAppStore((s) => s.update);
  const setUpdate = useAppStore((s) => s.setUpdate);
  const opened = useAppStore((s) => s.updateOpen);
  const setOpened = useAppStore((s) => s.setUpdateOpen);
  const [progress, setProgress] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let firstCheck = true;
    const run = () => {
      check()
        .then((u) => {
          if (!u) return;
          setUpdate(u);
          // Only the launch check pops the modal; a mid-shift find must not
          // interrupt whoever is at the counter.
          if (firstCheck) setOpened(true);
        })
        .catch((e) => console.warn('[updater] check failed:', e))
        .finally(() => {
          firstCheck = false;
        });
    };

    run();
    const id = window.setInterval(run, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [setUpdate, setOpened]);

  if (!update || !opened) return null;

  const downloading = progress !== null;

  const close = () => {
    if (!downloading) setOpened(false);
  };

  const install = async () => {
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((received / total) * 100)));
        }
      });
      await relaunch();
    } catch (e) {
      console.warn('[updater] install failed:', e);
      notifications.show({ color: 'red', message: t('update_failed') });
      setProgress(null);
      setOpened(false);
      setUpdate(null);
    }
  };

  return (
    <Modal
      opened
      onClose={close}
      title={t('update_title', { version: update.version })}
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={!downloading}
    >
      <Stack>
        {downloading ? (
          <>
            <Text>{t('update_downloading')}</Text>
            <Progress value={progress ?? 0} animated />
          </>
        ) : (
          <>
            <Text>{t('update_question')}</Text>
            <Group grow>
              <Button size="xl" variant="default" onClick={close}>
                {t('update_later')}
              </Button>
              <Button size="xl" onClick={install}>
                {t('update_now')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
