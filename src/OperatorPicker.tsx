import { Modal, Stack, Button, Text, Loader, Center, TextInput, ScrollArea, Card } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listUsers, type User } from './api';

// Shown whenever no operator is selected. Any active non-guest member can
// operate the software — search by name, tap to select (modelled on
// MemberPickerModal). Once such members exist it is non-dismissable (an
// operator must be chosen at launch). On a fresh/empty DB it is dismissable
// so the user can reach Members and create the first one.
export function OperatorPicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const operator = useAppStore((s) => s.operator);
  const setOperator = useAppStore((s) => s.setOperator);
  const lastOperatorUid = useAppStore((s) => s.lastOperatorUid);
  const [bootstrapDismissed, setBootstrapDismissed] = useState(false);
  const [text, setText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
    enabled: operator === null,
  });

  const pool = (data ?? []).filter((u) => u.active && !u.isGuest);
  const hasMembers = pool.length > 0;
  const dismissable = !hasMembers; // only during first-run bootstrap
  const opened = operator === null && (hasMembers || !bootstrapDismissed);

  useEffect(() => {
    if (opened) setText('');
  }, [opened]);

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((u) => !q || u.name.toLowerCase().includes(q));
  const lastOperator = pool.find((u) => u.uid === lastOperatorUid);

  const select = (u: User) => setOperator({ uid: u.uid, name: u.name, isAdmin: u.isAdmin });

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
        {!isLoading && !hasMembers && (
          <>
            <Text c="dimmed">{t('no_members_hint')}</Text>
            <Button size="lg" fullWidth onClick={goCreateFirst}>
              {t('add_first_member')}
            </Button>
          </>
        )}
        {!isLoading && hasMembers && (
          <>
            {lastOperator && (
              // data-autofocus here, not the search input, so the OS touch
              // keyboard doesn't pop on every launch.
              <Button size="lg" fullWidth data-autofocus onClick={() => select(lastOperator)}>
                {t('continue_as_operator', { name: lastOperator.name })}
              </Button>
            )}
            <TextInput
              size="lg"
              placeholder={t('select_operator_ph')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <ScrollArea h={360} type="auto">
              <Stack gap="xs">
                {filtered.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
                {filtered.map((u) => (
                  <Card
                    key={u.uid}
                    withBorder
                    padding="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => select(u)}
                  >
                    <Text fw={600}>{u.name}</Text>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
          </>
        )}
      </Stack>
    </Modal>
  );
}
