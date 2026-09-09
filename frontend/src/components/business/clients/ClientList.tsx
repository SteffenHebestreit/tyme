import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../../store/AppContext';
import { useClients, useCreateClient, useDeleteClient, useUpdateClient } from '../../../hooks/api/useClients';
import { Client } from '../../../api/types';
import { Button } from '../../common/Button';
import { Alert } from '../../common/Alert';
import { SkeletonCardList } from '../../common/Skeleton';
import { ClientFilters, ClientStatusFilter } from './ClientFilters';
import { ClientTable } from './ClientTable';
import { ClientFormModal } from './ClientFormModal';
import { ClientDocumentsModal } from './ClientDocumentsModal';
import { ClientEmptyState } from './ClientEmptyState';
import { extractErrorMessage } from '../../../utils/error';
import {
  ClientDocument,
  ClientDocumentUpdatePayload,
  ClientDocumentUploadPayload,
} from '../../../api/services/client-document.service';
import {
  useDeleteClientDocument,
  useUpdateClientDocument,
  useUploadClientDocument,
} from '../../../hooks/api/useClientDocuments';

export default function ClientList() {
  const { t } = useTranslation('clients');
  const { state } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClientStatusFilter>('all');
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [documentsClient, setDocumentsClient] = useState<Client | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentSuccess, setDocumentSuccess] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const listParams = useMemo(() => {
    return {
      search: debouncedSearch || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
    };
  }, [debouncedSearch, statusFilter]);

  const { data, isLoading, isError, error, refetch } = useClients(listParams);
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const uploadDocument = useUploadClientDocument();
  const updateDocument = useUpdateClientDocument();
  const deleteDocument = useDeleteClientDocument();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchTerm]);

  useEffect(() => {
    if (searchParams.get('modal') === 'new' && !isModalOpen) {
      setModalMode('create');
      setEditingClient(null);
      setFormError(null);
      setIsModalOpen(true);
    }
  }, [isModalOpen, searchParams]);

  // Use data directly, ensuring it updates when the query result changes
  const clients = useMemo(() => data ?? [], [data]);

  const openCreateModal = () => {
    setModalMode('create');
    setEditingClient(null);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setModalMode('edit');
    setEditingClient(client);
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingClient(null);
    setFormError(null);
    if (searchParams.get('modal')) {
      const next = new URLSearchParams(searchParams);
      next.delete('modal');
      setSearchParams(next, { replace: true });
    }
  };

  const handleSubmit = async (payload: Parameters<typeof createClient.mutateAsync>[0]) => {
    setFormError(null);
    setSuccessMessage(null);
    try {
      if (modalMode === 'create') {
        await createClient.mutateAsync(payload);
        setSuccessMessage(t('messages.created'));
      } else if (editingClient) {
        await updateClient.mutateAsync({ id: editingClient.id, payload });
        setSuccessMessage(t('messages.updated'));
      }
      closeModal();
    } catch (submitError) {
      setFormError(extractErrorMessage(submitError));
    }
  };

  const handleDelete = async (client: Client) => {
    const confirmed = window.confirm(t('messages.deleteConfirm', { name: client.name }));
    if (!confirmed) {
      return;
    }
    setDeleteError(null);
    setSuccessMessage(null);
    setDeletingId(client.id);
    try {
      await deleteClient.mutateAsync(client.id);
      setSuccessMessage(t('messages.deleted'));
    } catch (deleteErr) {
      setDeleteError(extractErrorMessage(deleteErr));
    } finally {
      setDeletingId(null);
    }
  };

  const openDocumentsModal = (client: Client) => {
    setDocumentError(null);
    setDocumentSuccess(null);
    setDocumentsClient(client);
  };

  const closeDocumentsModal = () => {
    setDocumentsClient(null);
    setDocumentError(null);
    setDocumentSuccess(null);
  };

  const handleDocumentUpload = async (payload: ClientDocumentUploadPayload) => {
    if (!documentsClient) {
      return false;
    }
    setDocumentError(null);
    setDocumentSuccess(null);
    try {
      await uploadDocument.mutateAsync({ clientId: documentsClient.id, payload });
      setDocumentSuccess(
        payload.supersedes_document_id
          ? t('documents.messages.versionUploaded')
          : t('documents.messages.uploaded')
      );
      return true;
    } catch (uploadError) {
      setDocumentError(extractErrorMessage(uploadError));
      return false;
    }
  };

  const handleDocumentUpdate = async (
    documentId: string,
    payload: ClientDocumentUpdatePayload
  ) => {
    setDocumentError(null);
    setDocumentSuccess(null);
    try {
      await updateDocument.mutateAsync({ documentId, payload });
      setDocumentSuccess(t('documents.messages.updated'));
      return true;
    } catch (updateError) {
      setDocumentError(extractErrorMessage(updateError));
      return false;
    }
  };

  const handleDocumentDelete = async (document: ClientDocument) => {
    const confirmed = window.confirm(
      t('documents.messages.deleteConfirm', { title: document.title })
    );
    if (!confirmed) {
      return false;
    }
    setDocumentError(null);
    setDocumentSuccess(null);
    setDeletingDocumentId(document.id);
    try {
      await deleteDocument.mutateAsync(document.id);
      setDocumentSuccess(t('documents.messages.deleted'));
      return true;
    } catch (documentDeleteError) {
      setDocumentError(extractErrorMessage(documentDeleteError));
      return false;
    } finally {
      setDeletingDocumentId(null);
    }
  };

  if (!state.isAuthenticated) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('noAuth')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={openCreateModal}>
            {t('addClient')}
          </Button>
        </div>
      </div>

      <ClientFilters
        search={searchTerm}
        status={statusFilter}
        onSearchChange={setSearchTerm}
        onStatusChange={setStatusFilter}
      />

      {successMessage ? (
        <Alert type="success" message={successMessage} onClose={() => setSuccessMessage(null)} />
      ) : null}

      {deleteError ? (
        <Alert type="error" message={deleteError} onClose={() => setDeleteError(null)} />
      ) : null}

      {isError ? (
        <Alert
          type="error"
          message={extractErrorMessage(error)}
          onClose={() => {
            setDeleteError(null);
            void refetch();
          }}
        />
      ) : null}

      {isLoading ? (
        <SkeletonCardList count={3} />
      ) : clients.length === 0 ? (
        <ClientEmptyState onCreate={openCreateModal} />
      ) : (
        <ClientTable 
          key={`${statusFilter}-${debouncedSearch}`}
          clients={clients} 
          onEdit={openEditModal}
          onDelete={handleDelete}
          onOpenDocuments={openDocumentsModal}
          isDeletingId={deletingId}
        />
      )}

      <ClientFormModal
        open={isModalOpen}
        mode={modalMode}
        initialClient={editingClient}
        onSubmit={handleSubmit}
        onClose={closeModal}
        isSubmitting={createClient.isPending || updateClient.isPending}
        error={formError}
      />

      {documentsClient ? (
        <ClientDocumentsModal
          open={Boolean(documentsClient)}
          client={documentsClient}
          onClose={closeDocumentsModal}
          onUpload={handleDocumentUpload}
          onUpdate={handleDocumentUpdate}
          onDelete={handleDocumentDelete}
          isUploading={uploadDocument.isPending}
          isSaving={updateDocument.isPending}
          deletingId={deletingDocumentId}
          error={documentError}
          successMessage={documentSuccess}
          onDismissError={() => setDocumentError(null)}
          onDismissSuccess={() => setDocumentSuccess(null)}
        />
      ) : null}
    </div>
  );
}
