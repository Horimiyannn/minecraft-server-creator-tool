'use client';
import { useRouter } from 'next/navigation';
import { Modal } from '@ui';
import { ROUTES } from '@/constants';
import { CreateWizard } from './CreateWizard';

export function CreateServerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title="New server">
      <CreateWizard
        onCreated={(id) => {
          onClose();
          router.push(ROUTES.server(id));
        }}
      />
    </Modal>
  );
}
