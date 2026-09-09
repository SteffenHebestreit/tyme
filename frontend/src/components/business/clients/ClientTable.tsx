/**
 * @fileoverview Client table component for displaying and managing client records.
 * 
 * Displays clients in a comprehensive table format with contact information,
 * status indicators, timestamps, and action buttons. Supports editing and
 * deleting clients with loading states.
 * 
 * Features:
 * - 5-column table: Client, Primary Contact, Status, Created, Actions
 * - Client name with truncated notes preview
 * - Email and phone contact display
 * - Status badges: green for active, gray for inactive
 * - Created and updated timestamps
 * - Edit and Delete action buttons
 * - Loading state during delete operations
 * - Hover effects for better UX
 * - Responsive with horizontal scroll
 * 
 * @module components/business/clients/ClientTable
 */

import { FC, useMemo } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Client } from '../../../api/types';
import { Button } from '../../common/Button';
import { Table, Column } from '../../common/Table';

/**
 * Props for the ClientTable component.
 * 
 * @interface ClientTableProps
 * @property {Client[]} clients - Array of client records to display
 * @property {(client: Client) => void} onEdit - Handler for edit button click
 * @property {(client: Client) => void} onDelete - Handler for delete button click
 * @property {(client: Client) => void} onOpenDocuments - Handler for opening the client's stored documents
 * @property {string | null} [isDeletingId] - ID of client currently being deleted (for loading state)
 */
interface ClientTableProps {
  clients: Client[];
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  onOpenDocuments: (client: Client) => void;
  isDeletingId?: string | null;
}

/**
 * CSS classes for client status badges.
 * Maps status values to Tailwind classes for background and text colors.
 * 
 * @constant
 * @type {Record<Client['status'], string>}
 */
const statusClasses: Record<Client['status'], string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  inactive: 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300',
};

/**
 * Formats an ISO date string for display.
 * 
 * Converts ISO 8601 date strings to readable format: "MMM d, yyyy"
 * Falls back to original string if parsing fails.
 * 
 * @function
 * @param {string} isoString - ISO 8601 date string to format
 * @returns {string} Formatted date string or original string if invalid
 * @example
 * formatDate('2024-01-15T10:30:00Z') // Returns: "Jan 15, 2024"
 * formatDate('invalid') // Returns: "invalid"
 */
const formatDate = (isoString: string) => {
  try {
    return format(new Date(isoString), 'MMM d, yyyy');
  } catch (error) {
    return isoString;
  }
};

/**
 * Table component for displaying client records with actions.
 * 
 * Displays clients in a structured table format with comprehensive information
 * including contact details, status, timestamps, and management actions.
 * 
 * Table Columns:
 * 1. **Client**: Client name (bold) + truncated notes (1 line max)
 * 2. **Primary Contact**: Email (normal size) + phone (smaller, below)
 * 3. **Status**: Badge indicator (Active in green, Inactive in gray)
 * 4. **Created**: Created date + updated date (smaller, below)
 * 5. **Actions**: Edit (outline) and Delete (danger) buttons
 * 
 * Status Display:
 * - **Active**: Green badge with "Active" text
 * - **Inactive**: Gray badge with "Inactive" text
 * - Rounded pill shape for visual distinction
 * 
 * Contact Information:
 * - Email displayed if available (primary contact)
 * - Phone displayed below email if available (secondary)
 * - Column empty if both missing
 * - Email and phone vertically stacked with gap
 * 
 * Timestamp Display:
 * - Created date shown in normal size
 * - Updated date shown below in smaller, lighter text
 * - Both formatted as "MMM d, yyyy"
 * - Vertically stacked in flex column
 * 
 * Action Buttons:
 * - **Edit**: Opens edit modal with client data
 * - **Delete**: Triggers delete operation with confirmation
 * - Delete button disabled and shows "Deleting…" during operation
 * - Buttons aligned to the right with gap
 * 
 * Loading States:
 * - Delete button shows "Deleting…" when isDeletingId matches client ID
 * - Button disabled during deletion to prevent double-clicks
 * 
 * Styling:
 * - White card with border and shadow
 * - Row hover effect for better interaction feedback
 * - Consistent padding and spacing
 * - Dark mode support throughout
 * - Responsive with horizontal scroll on small screens
 * 
 * @component
 * @example
 * // Basic usage
 * <ClientTable
 *   clients={clients}
 *   onEdit={(client) => {
 *     setSelectedClient(client);
 *     setIsEditModalOpen(true);
 *   }}
 *   onDelete={(client) => {
 *     if (confirm(`Delete ${client.name}?`)) {
 *       deleteClientMutation.mutate(client.id);
 *     }
 *   }}
 * />
 * 
 * @example
 * // With loading state tracking
 * <ClientTable
 *   clients={clients}
 *   onEdit={handleEditClient}
 *   onDelete={handleDeleteClient}
 *   isDeletingId={deleteClientMutation.variables}
 * />
 * 
 * @param {ClientTableProps} props - Component props
 * @returns {JSX.Element} Client table component
 */
export const ClientTable: FC<ClientTableProps> = ({ clients, onEdit, onDelete, onOpenDocuments, isDeletingId }) => {
  const { t } = useTranslation('clients');

  const columns: Column<Client>[] = useMemo(() => [
    {
      key: 'client',
      accessorKey: 'name',
      header: t('table.client'),
      render: (client) => (
        <>
          <div className="font-medium text-gray-900 dark:text-white">{client.name}</div>
          {client.notes ? (
            <p className="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">{client.notes}</p>
          ) : null}
        </>
      ),
      sortable: true,
    },
    {
      key: 'contact',
      accessorKey: 'email',
      header: t('table.contact'),
      render: (client) => (
        <div className="flex flex-col gap-1">
          {client.email && <span className="text-sm">{client.email}</span>}
          {client.phone && <span className="text-xs text-gray-500 dark:text-gray-400">{client.phone}</span>}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      accessorKey: 'status',
      header: t('table.status'),
      render: (client) => (
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[client.status]}`}>
          {client.status === 'active' ? t('status.active') : t('status.inactive')}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'created',
      accessorKey: 'created_at',
      header: t('table.created'),
      render: (client) => (
        <div className="flex flex-col">
          <span>{formatDate(client.created_at)}</span>
          <span className="text-xs text-gray-400">{t('table.updated')} {formatDate(client.updated_at)}</span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'actions',
      header: t('table.actions'),
      align: 'right',
      render: (client) => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenDocuments(client)}
          >
            {t('documents.action')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEdit(client)}
          >
            {t('edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => onDelete(client)}
            disabled={isDeletingId === client.id}
          >
            {isDeletingId === client.id ? t('deleting') : t('delete')}
          </Button>
        </div>
      ),
    },
  ], [t, onEdit, onDelete, onOpenDocuments, isDeletingId]);
  
  return <Table data={clients} columns={columns} pageSize={10} />;
};
