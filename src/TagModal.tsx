import { Modal, Stack, Chip, Group, Textarea, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWeapons, setWeaponTags, activeTagKeys, WEAPON_TAG_KEYS, type WeaponTagKey } from './api';
import { errorMessage } from './errors';
import { weaponLabel } from './labels';

// Condition tags + free comment for one weapon. Operators may set and clear —
// no admin needed (technician workflow).
export function TagModal({
  weaponUid,
  opened,
  onClose,
}: {
  weaponUid: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled: opened });
  const weapon = (weapons.data ?? []).find((w) => w.uid === weaponUid);

  const [keys, setKeys] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  // Re-seed from the weapon each open (and when the row arrives async).
  useEffect(() => {
    if (opened && weapon) {
      setKeys(activeTagKeys(weapon));
      setComment(weapon.tagComment ?? '');
    }
  }, [opened, weapon?.uid, weapon?.updatedAt]);

  const save = useMutation({
    mutationFn: () =>
      setWeaponTags(weaponUid!, {
        needsService: keys.includes('needs_service'),
        broken: keys.includes('broken'),
        missingParts: keys.includes('missing_parts'),
        needsCleaning: keys.includes('needs_cleaning'),
        comment: comment.trim() || null,
      }),
    onSuccess: () => {
      notifications.show({ message: t('tags_saved_ok') });
      qc.invalidateQueries({ queryKey: ['weapons'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={
        weapon
          ? `${t('edit_tags')} — ${weaponLabel(weapon.brand, weapon.model, weapon.caliber, weapon.displayId, weapon.active, t)}`
          : t('edit_tags')
      }
    >
      <Stack>
        <Chip.Group multiple value={keys} onChange={setKeys}>
          <Group gap="xs">
            {WEAPON_TAG_KEYS.map((k: WeaponTagKey) => (
              <Chip key={k} value={k} size="lg" color="orange">
                {t(`tag_${k}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Textarea
          label={t('field_tag_comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autosize
          minRows={2}
        />
        <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {t('save')}
        </Button>
      </Stack>
    </Modal>
  );
}
