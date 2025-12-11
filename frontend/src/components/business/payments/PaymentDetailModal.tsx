import { Modal } from '@/components/ui/Modal';
import { Payment } from '@/api/types';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useUpdatePayment } from '@/hooks/api/usePayments';
import { ExternalLink } from 'lucide-react';

interface PaymentDetailModalProps {
  payment: Payment | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToInvoice?: (invoiceId: string) => void;
}

export function PaymentDetailModal({ payment, isOpen, onClose, onNavigateToInvoice }: PaymentDetailModalProps) {
  const { t } = useTranslation('payments');
  const { t: tInvoices } = useTranslation('invoices');
  const [excludeFromTax, setExcludeFromTax] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const updatePaymentMutation = useUpdatePayment();

  // Initialize state when payment changes
  useEffect(() => {
    if (payment && isOpen) {
      setExcludeFromTax(payment.exclude_from_tax || false);
      setIsEditing(false);
    }
  }, [payment?.id, isOpen]);

  if (!payment) return null;

  const handleSave = async () => {
    try {
      await updatePaymentMutation.mutateAsync({
        id: payment.id,
        payload: {
          exclude_from_tax: excludeFromTax,
        },
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update payment:', error);
    }
  };

  const handleCancel = () => {
    setExcludeFromTax(payment.exclude_from_tax || false);
    setIsEditing(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getPaymentTypeLabel = (type: string) => {
    switch (type) {
      case 'payment':
        return {
          label: t('type.paymentIncome'),
          icon: '↓',
          color: 'text-green-600 dark:text-green-400',
        };
      case 'refund':
        return {
          label: t('type.refundOutgoing'),
          icon: '↑',
          color: 'text-red-600 dark:text-red-400',
        };
      case 'expense':
        return {
          label: 'Expense',
          icon: '💰',
          color: 'text-blue-600 dark:text-blue-400',
        };
      default:
        return {
          label: type,
          icon: '',
          color: 'text-gray-600 dark:text-gray-400',
        };
    }
  };

  const typeInfo = getPaymentTypeLabel(payment.payment_type);

  return (
    <Modal open={isOpen} onClose={onClose} title={t('view')} size="md">
      <div className="space-y-4">
        {/* Payment Type */}
        <div>
          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('fields.type')}
          </label>
          <p className={`mt-1 text-base font-semibold ${typeInfo.color}`}>
            {typeInfo.icon} {typeInfo.label}
          </p>
        </div>

        {/* Amount */}
        <div>
          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('fields.amount')}
          </label>
          <p className={`mt-1 text-2xl font-bold ${typeInfo.color}`}>
            {formatCurrency(payment.amount)}
          </p>
        </div>

        {/* Payment Date */}
        <div>
          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('fields.date')}
          </label>
          <p className="mt-1 text-base text-gray-900 dark:text-white">
            {formatDate(payment.payment_date)}
          </p>
        </div>

        {/* Payment Method */}
        {payment.payment_method && (
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('fields.method')}
            </label>
            <p className="mt-1 text-base text-gray-900 dark:text-white capitalize">
              {payment.payment_method.replace(/_/g, ' ')}
            </p>
          </div>
        )}

        {/* Transaction ID */}
        {payment.transaction_id && (
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('fields.transactionId')}
            </label>
            <p className="mt-1 text-base font-mono text-gray-900 dark:text-white">
              {payment.transaction_id}
            </p>
          </div>
        )}

        {/* Notes */}
        {payment.notes && (
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Notes
            </label>
            <p className="mt-1 text-base text-gray-900 dark:text-white whitespace-pre-wrap">
              {payment.notes}
            </p>
          </div>
        )}

        {/* Invoice ID (if linked) */}
        {payment.invoice_id && (
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('fields.linkedInvoice')}
            </label>
            {onNavigateToInvoice ? (
              <button
                onClick={() => {
                  onClose();
                  onNavigateToInvoice(payment.invoice_id!);
                }}
                className="mt-1 flex items-center gap-2 text-base text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
              >
                {payment.invoice_number || payment.invoice_id}
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : (
              <p className="mt-1 text-base text-gray-900 dark:text-white">
                {payment.invoice_number || payment.invoice_id}
              </p>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          {/* Exclude from Tax - Editable Field */}
          <div className="rounded-lg border-2 border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeFromTax}
                onChange={(e) => {
                  setExcludeFromTax(e.target.checked);
                  if (!isEditing) setIsEditing(true);
                }}
                className="mt-0.5 h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-amber-700 dark:bg-amber-900/20 dark:focus:ring-amber-600 dark:focus:ring-offset-gray-900"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {tInvoices('recordPayment.excludeFromTax.label')}
                </span>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  {tInvoices('recordPayment.excludeFromTax.description')}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Action Buttons - Show when editing */}
        {isEditing && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={updatePaymentMutation.isPending}
              className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-purple-500 dark:hover:bg-purple-600 dark:focus:ring-offset-gray-900"
            >
              {updatePaymentMutation.isPending ? t('messages.saving') : t('messages.saveChanges')}
            </button>
            <button
              onClick={handleCancel}
              disabled={updatePaymentMutation.isPending}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
            >
              {t('messages.cancel')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
