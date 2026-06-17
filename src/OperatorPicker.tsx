import { Modal, Stack, Button, Text, Loader, Center, Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAppStore } from './store';
import { listOperators } from './api';

// Shown whenever no operator is selected. Once operators exist it is
// non-dismissable (operator must be chosen at launch). On a fresh/empty DB it is
// dismissable so the user can reach Members and create the first staff member.
export function OperatorPicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const operator = useAppStore((s) => s.operator);
  const setOperator = useAppStore((s) => s.setOperator);
  const lastOperatorUid = useAppStore((s) => s.lastOperatorUid);
  const [bootstrapDismissed, setBootstrapDismissed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['operators'],
    queryFn: listOperators,
    enabled: operator === null,
  });

  const hasOperators = (data?.length ?? 0) > 0;
  const dismissable = !hasOperators; // only during first-run bootstrap
  const opened = operator === null && (hasOperators || !bootstrapDismissed);

  const options = (data ?? []).map((op) => ({ value: String(op.uid), label: op.name }));
  // Default to the last-used operator (if still an operator); the explicit pick
  // overrides once the user touches the dropdown.
  const lastStillValid = data?.some((op) => op.uid === lastOperatorUid) ?? false;
  const selected = picked ?? (lastStillValid ? String(lastOperatorUid) : null);

  const confirm = () => {
    const op = data?.find((o) => String(o.uid) === selected);
    if (op) setOperator({ uid: op.uid, name: op.name });
  };

  const goCreateFirst = () => {
    setBootstrapDismissed(true);
    navigate('/members');
  };

  return (
    <Modal
      opened={opened}
      onClose={() => dismissable && setBootstrapDismissed(true)}
      withCloseButton={dismissable}
      closeOnClickOutside={dismissable}
      closeOnEscape={dismissable}
      centered
      title={t('pick_operator')}
    >
      <Stack>
        {isLoading && (
          <Center>
            <Loader />
          </Center>
        )}
        {!isLoading && !hasOperators && (
          <>
            <Text c="dimmed">{t('no_operators_hint')}</Text>
            <Button size="lg" fullWidth onClick={goCreateFirst}>
              {t('add_first_operator')}
            </Button>
          </>
        )}
        {!isLoading && hasOperators && (
          <>
            <Select
              data={options}
              value={selected}
              onChange={setPicked}
              placeholder={t('select_operator_ph')}
              nothingFoundMessage={t('no_results')}
              searchable
            />
            <Button size="lg" fullWidth disabled={!selected} onClick={confirm} data-autofocus>
              {t('confirm_operator')}
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
