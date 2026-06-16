import { Modal, Stack, Button, Text, Loader, Center } from '@mantine/core';
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
  const [bootstrapDismissed, setBootstrapDismissed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['operators'],
    queryFn: listOperators,
    enabled: operator === null,
  });

  const hasOperators = (data?.length ?? 0) > 0;
  const dismissable = !hasOperators; // only during first-run bootstrap
  const opened = operator === null && (hasOperators || !bootstrapDismissed);

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
        {data?.map((op) => (
          <Button
            key={op.uid}
            size="lg"
            fullWidth
            variant="light"
            onClick={() => setOperator({ uid: op.uid, name: op.name })}
          >
            {op.name}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
}
