import { Modal, Stack, Group, Button, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { OpenCheckout } from './api';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';

/** Weapon / borrower / checked-out-at card. Shared between the fast-checkin
 *  numpad preview (matchCheckin in CheckinPage) and this modal's body so both
 *  render an identical card for the same open loan. */
export function CheckinLoanPreview({ loan }: { loan: OpenCheckout }) {
  const { t } = useTranslation();
  return (
    <Stack gap={2}>
      <Text fw={600} c="teal">
        {weaponLabel(
          loan.weaponBrand,
          loan.weaponModel,
          loan.weaponCaliber,
          loan.weaponDisplayId,
          loan.weaponActive,
          t,
        )}
      </Text>
      <Text size="sm">{userLabel(loan.userName, loan.userActive, t, loan.userIsGuest)}</Text>
      <Text size="xs" c="dimmed">
        {t('label_checked_out_at')}: {fmtDateTime(loan.checkedOutAt)}
      </Text>
    </Stack>
  );
}

interface CheckinConfirmModalProps {
  loan: OpenCheckout | null;
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

/** Shared yes/no confirmation for a scan-driven check-in. The modal owns no
 *  mutation — confirming calls the parent-supplied callback. */
export function CheckinConfirmModal({ loan, opened, onClose, onConfirm, loading }: CheckinConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('confirm_checkin_title')} centered>
      <Stack>
        {loan && <CheckinLoanPreview loan={loan} />}
        <Group justify="flex-end">
          <Button size="lg" variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="lg" color="teal" loading={loading} onClick={onConfirm}>
            {t('return_weapon')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
