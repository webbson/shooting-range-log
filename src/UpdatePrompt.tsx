import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// Prompt-on-launch updater: checks GitHub releases once at startup and asks the
// operator before downloading. Startup must never block or nag — check failures
// (offline laptop, GitHub unreachable) are logged and swallowed.
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    check()
      .then((u) => u && setUpdate(u))
      .catch((e) => console.warn('[updater] check failed:', e));
  }, []);

  if (!update) return null;

  const downloading = progress !== null;

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
      setUpdate(null);
    }
  };

  return (
    <Modal
      opened
      onClose={() => !downloading && setUpdate(null)}
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
              <Button size="xl" variant="default" onClick={() => setUpdate(null)}>
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
