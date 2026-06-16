import { Modal, Stack, Button, Text, Loader, Center } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { listOperators } from './api';

// Shown whenever no operator is selected. Non-dismissable — the operator must
// be chosen before using the app, and is recorded on every logged action.
export function OperatorPicker() {
  const { t } = useTranslation();
  const operatorName = useAppStore((s) => s.operatorName);
  const setOperator = useAppStore((s) => s.setOperator);
  const opened = operatorName === null;

  const { data, isLoading } = useQuery({
    queryKey: ['operators'],
    queryFn: listOperators,
    enabled: opened,
  });

  return (
    <Modal
      opened={opened}
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      title={t('pick_operator')}
    >
      <Stack>
        {isLoading && (
          <Center>
            <Loader />
          </Center>
        )}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <Text c="dimmed">{t('no_operators_hint')}</Text>
        )}
        {data?.map((op) => (
          <Button
            key={op.uid}
            size="lg"
            fullWidth
            variant="light"
            onClick={() => setOperator(op.name)}
          >
            {op.name}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
}
