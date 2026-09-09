/**
 * @fileoverview Client documents modal — the signed contracts and other
 * paperwork stored for a single customer.
 *
 * Opened from the actions column of {@link ClientTable}; the open/selected state
 * and every mutation live in {@link ClientList}, so this component only reads the
 * document list and renders the interactions.
 *
 * Features:
 * - Version chains: a document replaced by a newer upload is shown as one entry,
 *   with the current version on top and every superseded version collapsed
 *   underneath, so an old contract reads as history rather than as a duplicate
 * - Upload with metadata (title, type, project, signed/validity dates, notes)
 * - "New version" upload that sends `supersedes_document_id`, leaving the
 *   previous file downloadable
 * - Metadata-only edit, delete with confirmation, filter by project
 * - Authenticated download: the endpoint streams the file behind the Bearer
 *   token, so the file is fetched as a Blob through the shared axios client and
 *   saved via a synthetic `<a download>` click, revoking the object URL after
 *
 * @module components/business/clients/ClientDocumentsModal
 */

import { FC, useMemo, useState } from 'react';
import { FieldErrors, UseFormRegister, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Download, FileText, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { Client } from '../../../api/types';
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_TYPES,
  ClientDocument,
  ClientDocumentType,
  ClientDocumentUpdatePayload,
  ClientDocumentUploadPayload,
  downloadClientDocument,
  validateClientDocumentFile,
} from '../../../api/services/client-document.service';
import { useClientDocuments } from '../../../hooks/api/useClientDocuments';
import { useProjects } from '../../../hooks/api/useProjects';
import { Alert } from '../../common/Alert';
import { Button } from '../../common/Button';
import { Input, Select, Textarea } from '../../forms';
import { Modal } from '../../ui/Modal';
import { formatDate } from '../../../utils/date';
import { extractErrorMessage } from '../../../utils/error';

/**
 * Props for the ClientDocumentsModal component.
 *
 * @interface ClientDocumentsModalProps
 * @property {boolean} open - Whether the modal is visible
 * @property {Client} client - The client whose documents are shown
 * @property {() => void} onClose - Handler for closing the modal
 * @property {(payload: ClientDocumentUploadPayload) => Promise<boolean>} onUpload - Uploads a document; resolves true on success
 * @property {(documentId: string, payload: ClientDocumentUpdatePayload) => Promise<boolean>} onUpdate - Saves metadata; resolves true on success
 * @property {(document: ClientDocument) => Promise<boolean>} onDelete - Deletes a document after confirming; resolves true on success
 * @property {boolean} isUploading - Loading state of the upload mutation
 * @property {boolean} isSaving - Loading state of the update mutation
 * @property {string | null} [deletingId] - ID of the document currently being deleted
 * @property {string | null} [error] - Error message from the owning list
 * @property {string | null} [successMessage] - Success message from the owning list
 * @property {() => void} onDismissError - Dismisses the error alert
 * @property {() => void} onDismissSuccess - Dismisses the success alert
 */
interface ClientDocumentsModalProps {
  open: boolean;
  client: Client;
  onClose: () => void;
  onUpload: (payload: ClientDocumentUploadPayload) => Promise<boolean>;
  onUpdate: (documentId: string, payload: ClientDocumentUpdatePayload) => Promise<boolean>;
  onDelete: (document: ClientDocument) => Promise<boolean>;
  isUploading: boolean;
  isSaving: boolean;
  deletingId?: string | null;
  error?: string | null;
  successMessage?: string | null;
  onDismissError: () => void;
  onDismissSuccess: () => void;
}

/** Metadata fields shared by the upload and the edit form. All values are strings. */
interface MetadataFormValues {
  title: string;
  document_type: ClientDocumentType;
  project_id: string;
  signed_at: string;
  valid_from: string;
  valid_until: string;
  notes: string;
}

/** Upload form values — the metadata plus the picked file. */
interface UploadFormValues extends MetadataFormValues {
  file: FileList;
}

/** One version chain: the newest document plus its superseded predecessors. */
interface DocumentChain {
  current: ClientDocument;
  /** Superseded versions, newest first. */
  history: ClientDocument[];
}

/** Options for the project dropdowns. */
interface ProjectOption {
  id: string;
  name: string;
}

const UPLOAD_FORM_ID = 'client-document-upload-form';
const EDIT_FORM_ID = 'client-document-edit-form';

/**
 * Formats a byte count for display, mirroring the byte formatting used on the
 * system administration screen (contracts routinely exceed the KB range that
 * expense receipts use).
 *
 * @param {number | null | undefined} bytes - Size in bytes
 * @returns {string | null} Human-readable size, or null when unknown
 */
const formatFileSize = (bytes: number | null | undefined): string | null => {
  if (!bytes) {
    return null;
  }
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
};

/**
 * Groups a flat document list into version chains.
 *
 * A document that replaces another carries `supersedes_document_id`; following
 * those links from every root produces one chain per logical document. A chain
 * whose predecessor is filtered out of the current list simply starts at the
 * oldest document still present.
 *
 * @param {ClientDocument[]} documents - The client's documents
 * @returns {DocumentChain[]} Chains, newest current version first
 */
const buildDocumentChains = (documents: ClientDocument[]): DocumentChain[] => {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const successors = new Map<string, ClientDocument>();
  documents.forEach((document) => {
    if (document.supersedes_document_id && byId.has(document.supersedes_document_id)) {
      successors.set(document.supersedes_document_id, document);
    }
  });

  const roots = documents.filter(
    (document) =>
      !document.supersedes_document_id || !byId.has(document.supersedes_document_id)
  );

  const chains = roots
    .map((root) => {
      const ordered: ClientDocument[] = [root];
      const seen = new Set<string>([root.id]);
      let next = successors.get(root.id);
      while (next && !seen.has(next.id)) {
        ordered.push(next);
        seen.add(next.id);
        next = successors.get(next.id);
      }
      return {
        current: ordered[ordered.length - 1],
        history: ordered.slice(0, -1).reverse(),
      };
    });

  // `successors` holds one entry per predecessor, so if two documents supersede
  // the SAME predecessor only one continues the chain — the other is neither a
  // root nor reachable, and would vanish from the list entirely. Anything left
  // over becomes its own chain: a branched history is worth showing oddly, but
  // never worth hiding a signed document.
  const placed = new Set(chains.flatMap((chain) => [chain.current.id, ...chain.history.map((d) => d.id)]));
  documents.forEach((document) => {
    if (!placed.has(document.id)) {
      chains.push({ current: document, history: [] });
      placed.add(document.id);
    }
  });

  return chains.sort(
    (a, b) => new Date(b.current.created_at).getTime() - new Date(a.current.created_at).getTime()
  );
};

/**
 * The metadata fields shared by the upload and edit forms.
 * Rendered inside whichever form owns the `register` function passed in.
 */
const MetadataFields: FC<{
  register: UseFormRegister<UploadFormValues>;
  errors: FieldErrors<UploadFormValues>;
  projects: ProjectOption[];
  idPrefix: string;
}> = ({ register, errors, projects, idPrefix }) => {
  const { t } = useTranslation('clients');

  return (
    <>
      <Input
        id={`${idPrefix}-title`}
        label={t('documents.fields.title')}
        placeholder={t('documents.fields.titlePlaceholder')}
        required
        {...register('title', { required: t('documents.validation.titleRequired') })}
        error={errors.title?.message}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select id={`${idPrefix}-type`} label={t('documents.fields.type')} {...register('document_type')}>
          {CLIENT_DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`documents.types.${type}`)}
            </option>
          ))}
        </Select>
        <Select id={`${idPrefix}-project`} label={t('documents.fields.project')} {...register('project_id')}>
          <option value="">{t('documents.noProject')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id={`${idPrefix}-signed-at`}
          type="date"
          label={t('documents.fields.signedAt')}
          {...register('signed_at')}
        />
        <Input
          id={`${idPrefix}-valid-from`}
          type="date"
          label={t('documents.fields.validFrom')}
          {...register('valid_from')}
        />
        <Input
          id={`${idPrefix}-valid-until`}
          type="date"
          label={t('documents.fields.validUntil')}
          {...register('valid_until')}
        />
      </div>

      <Textarea
        id={`${idPrefix}-notes`}
        label={t('documents.fields.notes')}
        rows={2}
        placeholder={t('documents.fields.notesPlaceholder')}
        {...register('notes')}
      />
    </>
  );
};

/**
 * Upload panel — used both for a brand new document and for uploading a new
 * version of an existing one (in which case `supersedes` is set and its metadata
 * pre-fills the form).
 */
const UploadPanel: FC<{
  supersedes: ClientDocument | null;
  projects: ProjectOption[];
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: ClientDocumentUploadPayload) => Promise<boolean>;
}> = ({ supersedes, projects, isSubmitting, onCancel, onSubmit }) => {
  const { t } = useTranslation('clients');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<UploadFormValues>({
    defaultValues: {
      title: supersedes?.title ?? '',
      document_type: (supersedes?.document_type as ClientDocumentType) ?? 'contract',
      project_id: supersedes?.project_id ?? '',
      signed_at: '',
      valid_from: '',
      valid_until: '',
      notes: supersedes?.notes ?? '',
    },
  });

  const selectedFile = watch('file')?.[0] ?? null;
  const selectedFileSize = formatFileSize(selectedFile?.size);

  const handleFormSubmit = async (values: UploadFormValues) => {
    const file = values.file?.[0];
    if (!file) {
      return;
    }
    const succeeded = await onSubmit({
      file,
      title: values.title.trim(),
      document_type: values.document_type,
      project_id: values.project_id || undefined,
      signed_at: values.signed_at || undefined,
      valid_from: values.valid_from || undefined,
      valid_until: values.valid_until || undefined,
      notes: values.notes.trim() || undefined,
      supersedes_document_id: supersedes?.id,
    });
    if (succeeded) {
      onCancel();
    }
  };

  return (
    <form
      id={UPLOAD_FORM_ID}
      className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60"
      onSubmit={handleSubmit(handleFormSubmit)}
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        {supersedes ? t('documents.newVersionTitle') : t('documents.uploadTitle')}
      </h3>

      {supersedes ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">
            {t('documents.newVersionOf', { title: supersedes.title, version: supersedes.version })}
          </p>
          <p className="mt-1">{t('documents.newVersionHint')}</p>
        </div>
      ) : null}

      <div>
        <label
          htmlFor="client-document-file"
          className={`mb-2 block text-sm font-medium ${
            errors.file
              ? 'text-red-500 dark:text-red-400'
              : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {t('documents.fields.file')}
        </label>
        <input
          id="client-document-file"
          type="file"
          accept={CLIENT_DOCUMENT_ACCEPT}
          className="block w-full cursor-pointer text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-purple-700 dark:text-gray-300 dark:file:bg-purple-500 dark:hover:file:bg-purple-400"
          {...register('file', {
            validate: (list) => {
              const file = list?.[0];
              if (!file) {
                return t('documents.validation.fileRequired');
              }
              const problem = validateClientDocumentFile(file);
              if (problem === 'size') {
                return t('documents.validation.fileTooLarge');
              }
              if (problem === 'type') {
                return t('documents.validation.fileType');
              }
              return true;
            },
          })}
        />
        {errors.file ? (
          <p className="mt-1 text-xs text-red-500">{errors.file.message}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {selectedFile
              ? `${selectedFile.name}${selectedFileSize ? ` · ${selectedFileSize}` : ''}`
              : t('documents.fields.fileHint')}
          </p>
        )}
      </div>

      <MetadataFields
        register={register}
        errors={errors}
        projects={projects}
        idPrefix="client-document-upload"
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('documents.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? t('documents.uploading') : t('documents.upload')}
        </Button>
      </div>
    </form>
  );
};

/**
 * Edit panel — metadata only. The stored file is immutable; replacing it means
 * uploading a new version instead.
 */
const EditPanel: FC<{
  document: ClientDocument;
  projects: ProjectOption[];
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (documentId: string, payload: ClientDocumentUpdatePayload) => Promise<boolean>;
}> = ({ document, projects, isSubmitting, onCancel, onSubmit }) => {
  const { t } = useTranslation('clients');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UploadFormValues>({
    defaultValues: {
      title: document.title,
      document_type: (document.document_type as ClientDocumentType) ?? 'contract',
      project_id: document.project_id ?? '',
      signed_at: document.signed_at ? document.signed_at.slice(0, 10) : '',
      valid_from: document.valid_from ? document.valid_from.slice(0, 10) : '',
      valid_until: document.valid_until ? document.valid_until.slice(0, 10) : '',
      notes: document.notes ?? '',
    },
  });

  const handleFormSubmit = async (values: UploadFormValues) => {
    const succeeded = await onSubmit(document.id, {
      title: values.title.trim(),
      document_type: values.document_type,
      project_id: values.project_id || null,
      signed_at: values.signed_at || null,
      valid_from: values.valid_from || null,
      valid_until: values.valid_until || null,
      notes: values.notes.trim() || null,
    });
    if (succeeded) {
      onCancel();
    }
  };

  return (
    <form
      id={EDIT_FORM_ID}
      className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60"
      onSubmit={handleSubmit(handleFormSubmit)}
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('documents.editTitle', { title: document.title })}
      </h3>

      <MetadataFields
        register={register}
        errors={errors}
        projects={projects}
        idPrefix="client-document-edit"
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('documents.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? t('documents.saving') : t('documents.save')}
        </Button>
      </div>
    </form>
  );
};

/**
 * A single document row. The current version is rendered as a full card; a
 * superseded version is rendered muted and struck-through inside the history
 * section, so it reads as history rather than as a duplicate.
 */
const DocumentRow: FC<{
  document: ClientDocument;
  variant: 'current' | 'history';
  isDownloading: boolean;
  isDeleting: boolean;
  onDownload: (document: ClientDocument) => void;
  onNewVersion: (document: ClientDocument) => void;
  onEdit: (document: ClientDocument) => void;
  onDelete: (document: ClientDocument) => void;
}> = ({
  document,
  variant,
  isDownloading,
  isDeleting,
  onDownload,
  onNewVersion,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation('clients');
  const isCurrent = variant === 'current';
  const size = formatFileSize(document.file_size);

  return (
    <div
      className={
        isCurrent
          ? 'flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between'
          : 'flex flex-col gap-2 rounded-lg bg-gray-50 px-3 py-2 md:flex-row md:items-center md:justify-between dark:bg-gray-800/50'
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <FileText
            className={
              isCurrent
                ? 'h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400'
                : 'h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500'
            }
            aria-hidden="true"
          />
          <span
            className={
              isCurrent
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-sm text-gray-500 line-through dark:text-gray-400'
            }
          >
            {document.title}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              isCurrent
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {t('documents.version', { number: document.version })}
          </span>
          {isCurrent ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/30 dark:text-green-300">
              {t('documents.current')}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {t('documents.superseded')}
            </span>
          )}
        </div>

        {isCurrent ? (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3 dark:text-gray-400">
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.type')}:</dt>
              <dd>{t(`documents.types.${document.document_type}`, { defaultValue: document.document_type })}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.project')}:</dt>
              <dd>{document.project_name ?? t('documents.noProject')}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.signedAt')}:</dt>
              <dd>{formatDate(document.signed_at)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.validFrom')}:</dt>
              <dd>{formatDate(document.valid_from)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.validUntil')}:</dt>
              <dd>{formatDate(document.valid_until)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{t('documents.fields.file')}:</dt>
              <dd className="truncate">
                {document.file_filename ?? '—'}
                {size ? ` · ${size}` : ''}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {document.file_filename ?? '—'}
            {size ? ` · ${size}` : ''}
          </p>
        )}

        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {t('documents.uploadedOn', { date: formatDate(document.created_at) })}
        </p>

        {isCurrent && document.notes ? (
          <p className="mt-2 whitespace-pre-line text-xs text-gray-600 dark:text-gray-300">
            {document.notes}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onDownload(document)}
          disabled={isDownloading}
        >
          <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {isDownloading ? t('documents.downloading') : t('documents.download')}
        </Button>
        {isCurrent ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => onNewVersion(document)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t('documents.newVersion')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onEdit(document)}>
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t('documents.edit')}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => onDelete(document)}
          disabled={isDeleting}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {isDeleting ? t('documents.deleting') : t('documents.delete')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Modal listing and managing a client's stored documents.
 *
 * @component
 * @example
 * {documentsClient ? (
 *   <ClientDocumentsModal
 *     open={isDocumentsModalOpen}
 *     client={documentsClient}
 *     onClose={closeDocumentsModal}
 *     onUpload={handleDocumentUpload}
 *     onUpdate={handleDocumentUpdate}
 *     onDelete={handleDocumentDelete}
 *     isUploading={uploadDocument.isPending}
 *     isSaving={updateDocument.isPending}
 *     deletingId={deletingDocumentId}
 *     error={documentError}
 *     successMessage={documentSuccess}
 *     onDismissError={() => setDocumentError(null)}
 *     onDismissSuccess={() => setDocumentSuccess(null)}
 *   />
 * ) : null}
 *
 * @param {ClientDocumentsModalProps} props - Component props
 * @returns {JSX.Element} The documents modal
 */
export const ClientDocumentsModal: FC<ClientDocumentsModalProps> = ({
  open,
  client,
  onClose,
  onUpload,
  onUpdate,
  onDelete,
  isUploading,
  isSaving,
  deletingId,
  error,
  successMessage,
  onDismissError,
  onDismissSuccess,
}) => {
  const { t } = useTranslation('clients');

  const [projectFilter, setProjectFilter] = useState('');
  const [panel, setPanel] = useState<
    | { kind: 'none' }
    | { kind: 'upload' }
    | { kind: 'version'; document: ClientDocument }
    | { kind: 'edit'; document: ClientDocument }
  >({ kind: 'none' });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [expandedChains, setExpandedChains] = useState<string[]>([]);

  const filters = useMemo(
    () => (projectFilter ? { project_id: projectFilter } : undefined),
    [projectFilter]
  );

  const {
    data: documents,
    isLoading,
    isError,
    error: listError,
  } = useClientDocuments(client.id, filters, open);
  const { data: projectData } = useProjects({ clientId: client.id });

  const projects = useMemo<ProjectOption[]>(
    () => (projectData ?? []).map((project) => ({ id: project.id, name: project.name })),
    [projectData]
  );

  const chains = useMemo(() => buildDocumentChains(documents ?? []), [documents]);

  const closePanel = () => setPanel({ kind: 'none' });

  const toggleHistory = (chainId: string) => {
    setExpandedChains((current) =>
      current.includes(chainId)
        ? current.filter((id) => id !== chainId)
        : [...current, chainId]
    );
  };

  /**
   * Downloads a document's file.
   *
   * The endpoint requires the Bearer token, so the file cannot be linked to
   * directly: it is fetched as a Blob through the shared axios client, saved via
   * a synthetic anchor click, and the object URL is revoked immediately after.
   */
  const handleDownload = async (document_: ClientDocument) => {
    setDownloadError(null);
    setDownloadingId(document_.id);
    let objectUrl: string | null = null;
    try {
      const blob = await downloadClientDocument(document_.id);
      objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = document_.file_filename || document_.title;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
    } catch (downloadErr) {
      // The request is made with responseType 'blob', so an error body arrives
      // as a Blob rather than JSON and extractErrorMessage yields noise like
      // "[object Blob]". The translated message is the useful one here.
      console.error('Client document download failed', downloadErr);
      setDownloadError(t('documents.downloadError'));
    } finally {
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
      setDownloadingId(null);
    }
  };

  const handleDelete = async (document_: ClientDocument) => {
    const succeeded = await onDelete(document_);
    if (succeeded && panel.kind === 'edit' && panel.document.id === document_.id) {
      closePanel();
    }
  };

  const listErrorMessage = isError
    ? extractErrorMessage(listError) || t('documents.loadError')
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('documents.title', { name: client.name })}
      size="xl"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          {t('documents.close')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('documents.subtitle')}</p>

        {error ? <Alert type="error" message={error} onClose={onDismissError} /> : null}
        {successMessage ? (
          <Alert type="success" message={successMessage} onClose={onDismissSuccess} />
        ) : null}
        {downloadError ? (
          <Alert type="error" message={downloadError} onClose={() => setDownloadError(null)} />
        ) : null}
        {listErrorMessage ? <Alert type="error" message={listErrorMessage} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <Select
              id="client-document-project-filter"
              label={t('documents.filterProject')}
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="">{t('documents.allProjects')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" size="sm" onClick={() => setPanel({ kind: 'upload' })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('documents.upload')}
          </Button>
        </div>

        {panel.kind === 'upload' || panel.kind === 'version' ? (
          <UploadPanel
            key={panel.kind === 'version' ? panel.document.id : 'new'}
            supersedes={panel.kind === 'version' ? panel.document : null}
            projects={projects}
            isSubmitting={isUploading}
            onCancel={closePanel}
            onSubmit={onUpload}
          />
        ) : null}

        {panel.kind === 'edit' ? (
          <EditPanel
            key={panel.document.id}
            document={panel.document}
            projects={projects}
            isSubmitting={isSaving}
            onCancel={closePanel}
            onSubmit={onUpdate}
          />
        ) : null}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('documents.loading')}
          </p>
        ) : chains.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {projectFilter ? t('documents.emptyFiltered') : t('documents.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {chains.map((chain) => {
              const isExpanded = expandedChains.includes(chain.current.id);
              return (
                <li
                  key={chain.current.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
                >
                  <DocumentRow
                    document={chain.current}
                    variant="current"
                    isDownloading={downloadingId === chain.current.id}
                    isDeleting={deletingId === chain.current.id}
                    onDownload={handleDownload}
                    onNewVersion={(document_) => setPanel({ kind: 'version', document: document_ })}
                    onEdit={(document_) => setPanel({ kind: 'edit', document: document_ })}
                    onDelete={handleDelete}
                  />

                  {chain.history.length > 0 ? (
                    <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 hover:underline dark:text-purple-400"
                        onClick={() => toggleHistory(chain.current.id)}
                      >
                        <History className="h-3.5 w-3.5" aria-hidden="true" />
                        {isExpanded
                          ? t('documents.hideHistory')
                          : t('documents.showHistory', { versions: chain.history.length })}
                      </button>

                      {isExpanded ? (
                        <div className="mt-2 space-y-2">
                          {chain.history.map((historic) => (
                            <DocumentRow
                              key={historic.id}
                              document={historic}
                              variant="history"
                              isDownloading={downloadingId === historic.id}
                              isDeleting={deletingId === historic.id}
                              onDownload={handleDownload}
                              onNewVersion={(document_) =>
                                setPanel({ kind: 'version', document: document_ })
                              }
                              onEdit={(document_) => setPanel({ kind: 'edit', document: document_ })}
                              onDelete={handleDelete}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default ClientDocumentsModal;
