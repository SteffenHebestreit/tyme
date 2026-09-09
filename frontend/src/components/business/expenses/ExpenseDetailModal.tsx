import { useExpense, useDeleteExpense, useUpdateExpense, useUploadReceipt, useDeleteReceipt, useRecurringGeneratedExpenses } from '@/hooks/api/useExpenses';
import { formatCurrency } from '@/utils/currency';
import { Textarea, Input, CustomSelect } from '@/components/forms';
import { Modal } from '@/components/ui/Modal';
import { useState, useEffect } from 'react';
import { FileText, Download, Trash2, Upload, Eye, X, Edit2, Save } from 'lucide-react';
import api from '@/api/services/client';
import { useTranslation } from 'react-i18next';
import { DepreciationSettings } from '@/components/business/expenses/DepreciationSettings';
import { DepreciationAnalysisSection } from '@/components/business/expenses/DepreciationAnalysisSection';
import { Slot } from '@/plugins/slots';

interface ExpenseDetailModalProps {
  expenseId: string;
  isOpen: boolean;
  onClose: () => void;
  onExpenseUpdated: () => void;
}

export function ExpenseDetailModal({
  expenseId,
  isOpen,
  onClose,
  onExpenseUpdated,
}: ExpenseDetailModalProps) {
  const { t } = useTranslation('expenses');
  const { data: expense, isLoading } = useExpense(expenseId, isOpen);
  const { data: generatedExpenses = [], isLoading: isLoadingGenerated } = useRecurringGeneratedExpenses(
    expenseId,
    isOpen && !!expense?.is_recurring
  );
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();
  const uploadReceipt = useUploadReceipt();
  const deleteReceipt = useDeleteReceipt();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedExpense, setEditedExpense] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  // Initialize edited expense when expense data loads or edit mode is toggled
  useEffect(() => {
    if (expense && isEditing && !editedExpense) {
      setEditedExpense({
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        expense_date: expense.expense_date.split('T')[0],
        notes: expense.notes || '',
        recurrence_frequency: expense.recurrence_frequency || 'monthly',
        recurrence_start_date: expense.recurrence_start_date ? expense.recurrence_start_date.split('T')[0] : '',
        recurrence_end_date: expense.recurrence_end_date ? expense.recurrence_end_date.split('T')[0] : '',
        depreciation_type: expense.depreciation_type || null,
        depreciation_years: expense.depreciation_years || null,
        depreciation_method: expense.depreciation_method || null,
        useful_life_category: expense.useful_life_category || null, // Backend field name
        tax_deductible_amount: expense.tax_deductible_amount || null,
      });
    }
  }, [expense, isEditing, editedExpense]);

  // Fetch receipt image as blob for preview (with auth)
  useEffect(() => {
    if (showReceiptPreview && expense?.id) {
      const fetchReceiptBlob = async () => {
        try {
          const response = await api.get(`/expenses/${expense.id}/receipt/download`, {
            responseType: 'blob',
          });
          
          const blob = response.data as Blob;
          const url = URL.createObjectURL(blob);
          setReceiptPreviewUrl(url);
        } catch (error) {
          console.error('Failed to load receipt preview:', error);
        }
      };
      
      fetchReceiptBlob();
    }
    
    // Cleanup blob URL when modal closes
    return () => {
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
        setReceiptPreviewUrl(null);
      }
    };
  }, [showReceiptPreview, expense?.id]);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    try {
      await deleteExpense.mutateAsync(expenseId);
      onExpenseUpdated();
      onClose();
    } catch (error) {
      console.error('Failed to delete expense:', error);
    }
  };

  const handleSaveEdit = async () => {
    if (!editedExpense) return;

    try {
      // Clean up data before sending to backend
      const dataToSend = { ...editedExpense };
      
      // Remove or null out empty recurrence fields if expense is not recurring
      if (!expense?.is_recurring) {
        delete dataToSend.recurrence_frequency;
        delete dataToSend.recurrence_start_date;
        delete dataToSend.recurrence_end_date;
      } else {
        // Convert empty strings to null for optional recurrence_end_date
        if (dataToSend.recurrence_end_date === '') {
          dataToSend.recurrence_end_date = null;
        }
      }

      // Set depreciation_start_date to expense_date if not set and depreciation is partial
      if (dataToSend.depreciation_type === 'partial' && !dataToSend.depreciation_start_date) {
        dataToSend.depreciation_start_date = expense?.expense_date || dataToSend.expense_date;
      }
      
      await updateExpense.mutateAsync({
        expenseId,
        data: dataToSend,
      });
      setIsEditing(false);
      setEditedExpense(null);
      onExpenseUpdated();
    } catch (error: any) {
      console.error('Failed to update expense:', error);
      const reason =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Unknown error';
      alert(`Failed to update expense: ${reason}`);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedExpense(null);
  };

  const isImage = (mimetype?: string | null) => mimetype?.startsWith('image/');

  const handleUploadReceipt = async () => {
    if (!receiptFile) return;

    try {
      await uploadReceipt.mutateAsync({ expenseId, file: receiptFile });
      setReceiptFile(null);
      onExpenseUpdated();
    } catch (error) {
      console.error('Failed to upload receipt:', error);
      alert('Failed to upload receipt. Please try again.');
    }
  };

  const handleDownloadReceipt = async () => {
    if (!expense) return;
    
    try {
      const response = await api.get(`/expenses/${expense.id}/receipt/download`, {
        responseType: 'blob',
      });
      
      // Create download link from blob
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = expense.receipt_filename || 'receipt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download receipt:', error);
      alert('Failed to download receipt. Please try again.');
    }
  };

  const handleDeleteReceipt = async () => {
    if (!confirm('Are you sure you want to delete this receipt?')) return;

    try {
      await deleteReceipt.mutateAsync(expenseId);
      onExpenseUpdated();
    } catch (error) {
      console.error('Failed to delete receipt:', error);
      alert('Failed to delete receipt. Please try again.');
    }
  };

  if (!isOpen) return null;

  // getStatusBadgeColor removed - status field hidden for solo freelancer use
  
  if (!isOpen && !showReceiptPreview) return null;

  return (
    <>
      {/* Main Expense Detail Modal */}
      <Modal
        open={isOpen && !showReceiptPreview}
        onClose={onClose}
        title="Expense Details"
        size="lg"
      >
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
          </div>
        ) : expense ? (
          <div className="space-y-6">
            {/* Edit Mode Toggle Buttons */}
            <div className="flex justify-between pb-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                {!isEditing && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteExpense.isPending}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    {deleteExpense.isPending ? 'Deleting...' : 'Delete Expense'}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/20 dark:hover:bg-purple-900/30 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Expense
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={updateExpense.isPending}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      {updateExpense.isPending ? 'Saving...' : 'Save Changes'}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {/* Description */}
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Description
                </label>
                {isEditing ? (
                  <Input
                    value={editedExpense?.description || ''}
                    onChange={(e) => setEditedExpense({ ...editedExpense, description: e.target.value })}
                    className="mt-1"
                    placeholder="Enter expense description"
                  />
                ) : (
                  <p className="mt-1 text-base text-gray-900 dark:text-white">
                    {expense.description}
                  </p>
                )}
              </div>

              {/* Amount and Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Amount
                  </label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={editedExpense?.amount || ''}
                      onChange={(e) => setEditedExpense({ ...editedExpense, amount: parseFloat(e.target.value) })}
                      className="mt-1"
                      placeholder="0.00"
                    />
                  ) : (
                    <p className="mt-1 text-xl font-semibold text-red-600 dark:text-red-400">
                      {formatCurrency(expense.amount, expense.currency)}
                    </p>
                  )}
                </div>
                {/* Status field hidden - not needed for solo freelancer (all expenses auto-approved) */}
              </div>

              {/* Category and Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Category
                  </label>
                  {isEditing ? (
                    <CustomSelect
                      value={editedExpense?.category || ''}
                      onChange={(value) => setEditedExpense({ ...editedExpense, category: value })}
                      options={[
                        // IT & Digital Equipment
                        { value: 'computer', label: 'Computer/Laptop/Tablet' },
                        { value: 'software', label: 'Software & Licenses' },
                        { value: 'peripherals', label: 'Peripherals (Keyboard, Mouse, etc.)' },
                        { value: 'storage', label: 'Storage (HDD, USB, etc.)' },
                        { value: 'display', label: 'Monitor/Display/Projector' },
                        { value: 'printer', label: 'Printer/Scanner' },
                        
                        // Office
                        { value: 'office_furniture', label: 'Office Furniture' },
                        { value: 'office_equipment', label: 'Office Equipment' },
                        { value: 'office_supplies', label: 'Office Supplies' },
                        
                        // Vehicles
                        { value: 'vehicle_car', label: 'Car/Vehicle' },
                        { value: 'vehicle_motorcycle', label: 'Motorcycle/E-bike' },
                        
                        // Tools
                        { value: 'camera', label: 'Camera/Photography Equipment' },
                        { value: 'tools', label: 'Tools/Equipment' },
                        { value: 'machinery', label: 'Machinery' },
                        
                        // Services & Operating Expenses
                        { value: 'insurance', label: 'Insurance' },
                        { value: 'professional_services', label: 'Professional Services' },
                        { value: 'marketing', label: 'Marketing/Advertising' },
                        { value: 'utilities', label: 'Utilities' },
                        { value: 'travel', label: 'Travel' },
                        { value: 'meals', label: 'Meals & Entertainment' },
                        { value: 'training', label: 'Training/Education' },
                        { value: 'rent', label: 'Rent' },
                        { value: 'telecommunications', label: 'Phone/Internet' },
                        
                        { value: 'other', label: 'Other' },
                      ]}
                      size="md"
                    />
                  ) : (
                    <p className="mt-1 text-base text-gray-900 dark:text-white capitalize">
                      {expense.category.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Expense Date
                  </label>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={editedExpense?.expense_date || ''}
                      onChange={(e) => setEditedExpense({ ...editedExpense, expense_date: e.target.value })}
                      className="mt-1"
                    />
                  ) : (
                    <p className="mt-1 text-base text-gray-900 dark:text-white">
                      {new Date(expense.expense_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Project */}
              {expense.project_name && (
                <div>
                  <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Project
                  </label>
                  <p className="mt-1 text-base text-gray-900 dark:text-white">
                    {expense.project_name}
                    {expense.client_name && (
                      <span className="text-gray-500 dark:text-gray-400"> • {expense.client_name}</span>
                    )}
                  </p>
                </div>
              )}

              {/* Flags */}
              {expense.is_reimbursable && !isEditing && (
                <div className="flex gap-4">
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                    Reimbursable
                  </span>
                </div>
              )}

              {/* Recurring Expense Information */}
              {expense.is_recurring && (
                <div className="border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-r-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-700 dark:text-purple-400 font-medium">
                        🔄 {t('recurring.recurring', 'Recurring Expense')}
                      </span>
                    </div>
                  </div>
                  
                  {isEditing ? (
                    <div className="grid grid-cols-2 gap-4">
                      {/* Frequency */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('recurring.frequency', 'Frequency')}
                        </label>
                        <select
                          value={editedExpense?.recurrence_frequency || 'monthly'}
                          onChange={(e) => setEditedExpense({ ...editedExpense, recurrence_frequency: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="monthly">{t('recurring.monthly', 'Monthly')}</option>
                          <option value="quarterly">{t('recurring.quarterly', 'Quarterly')}</option>
                          <option value="yearly">{t('recurring.yearly', 'Yearly')}</option>
                        </select>
                      </div>
                      
                      {/* Start Date */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('recurring.startDate', 'Start Date')}
                        </label>
                        <input
                          type="date"
                          value={editedExpense?.recurrence_start_date || ''}
                          onChange={(e) => setEditedExpense({ ...editedExpense, recurrence_start_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>
                      
                      {/* End Date */}
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('recurring.endDate', 'End Date (Optional)')}
                        </label>
                        <input
                          type="date"
                          value={editedExpense?.recurrence_end_date || ''}
                          onChange={(e) => setEditedExpense({ ...editedExpense, recurrence_end_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">{t('recurring.frequency', 'Frequency')}:</span>
                        <span className="ml-2 font-medium text-gray-900 dark:text-gray-100 capitalize">
                          {expense.recurrence_frequency}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">{t('recurring.startDate', 'Start Date')}:</span>
                        <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                          {expense.recurrence_start_date ? new Date(expense.recurrence_start_date).toLocaleDateString() : '-'}
                        </span>
                      </div>
                      {expense.recurrence_end_date && (
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">{t('recurring.endDate', 'End Date')}:</span>
                          <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                            {new Date(expense.recurrence_end_date).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {expense.next_occurrence && (
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">{t('recurring.nextOccurrence', 'Next Generation')}:</span>
                          <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                            {new Date(expense.next_occurrence).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Auto-Generated Expense Information */}
              {expense.parent_expense_id && (
                <div className="border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-r-lg">
                  <span className="text-blue-700 dark:text-blue-400 font-medium">
                    ℹ️ {t('recurring.autoGenerated', 'Auto-generated')} - {t('recurring.generatedFromTemplate', 'This expense was automatically generated from a recurring expense template')}
                  </span>
                </div>
              )}

              {/* Generated Expenses List */}
              {expense.is_recurring && !expense.parent_expense_id && (
                <div className="border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-r-lg">
                  <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400 mb-3 flex items-center gap-2">
                    📋 {t('recurring.generatedExpenses', 'Generated Expenses')} 
                    {!isLoadingGenerated && generatedExpenses.length > 0 && (
                      <span className="text-xs bg-purple-200 dark:bg-purple-800 px-2 py-0.5 rounded-full">
                        {generatedExpenses.length}
                      </span>
                    )}
                  </h4>
                  
                  {isLoadingGenerated ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400">Loading...</p>
                  ) : generatedExpenses.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {generatedExpenses.map((generated) => (
                        <div 
                          key={generated.id}
                          className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded border border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {new Date(generated.expense_date).toLocaleDateString()}
                            </p>
                            {generated.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {generated.description}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {formatCurrency(generated.amount, generated.currency)}
                            </p>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              generated.status === 'approved'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : generated.status === 'rejected'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                              {generated.status === 'approved' ? 'Approved' : generated.status === 'rejected' ? 'Rejected' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t('recurring.noGeneratedYet', 'No expenses have been generated yet. The scheduler will create them automatically.')}
                    </p>
                  )}
                </div>
              )}

                  {/* Receipt */}
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 block">
                      Receipt
                    </label>
                    
                    {expense.receipt_url ? (
                      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-purple-600 flex-shrink-0" />
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">
                                {expense.receipt_filename}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {expense.receipt_size ? `${(expense.receipt_size / 1024).toFixed(2)} KB` : 'Unknown size'}
                                {expense.receipt_mimetype && ` • ${expense.receipt_mimetype}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {isImage(expense.receipt_mimetype) && (
                              <button
                                onClick={() => setShowReceiptPreview(true)}
                                className="p-2 text-gray-600 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400 transition-colors"
                                title="Preview receipt"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={handleDownloadReceipt}
                              className="p-2 text-gray-600 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400 transition-colors"
                              title="Download receipt"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleDeleteReceipt}
                              disabled={deleteReceipt.isPending}
                              className="p-2 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete receipt"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6">
                        {receiptFile ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                              <div className="flex items-center gap-3">
                                <FileText className="w-6 h-6 text-purple-600" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {receiptFile.name}
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {(receiptFile.size / 1024).toFixed(2)} KB
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => setReceiptFile(null)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                            <button
                              onClick={handleUploadReceipt}
                              disabled={uploadReceipt.isPending}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Upload className="w-4 h-4" />
                              {uploadReceipt.isPending ? 'Uploading...' : 'Upload Receipt'}
                            </button>
                          </div>
                        ) : (
                          <div className="text-center">
                            <Upload className="mx-auto h-8 w-8 text-gray-400 mb-3" />
                            <label htmlFor="receipt-upload" className="cursor-pointer">
                              <span className="text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium">
                                Upload a receipt
                              </span>
                              <input
                                id="receipt-upload"
                                type="file"
                                className="sr-only"
                                accept="image/*,application/pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) setReceiptFile(file);
                                }}
                              />
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              PNG, JPG, WebP or PDF up to 5MB
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

              {/* Notes */}
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Notes
                </label>
                {isEditing ? (
                  <Textarea
                    value={editedExpense?.notes || ''}
                    onChange={(e) => setEditedExpense({ ...editedExpense, notes: e.target.value })}
                    placeholder="Add notes about this expense..."
                    rows={3}
                    className="mt-1"
                  />
                ) : expense.notes ? (
                  <p className="mt-1 text-base text-gray-900 dark:text-white whitespace-pre-wrap">
                    {expense.notes}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500 italic">No notes</p>
                )}
              </div>

              {/* Depreciation Settings */}
              {isEditing && (
                <DepreciationSettings
                  depreciationType={editedExpense?.depreciation_type}
                  depreciationYears={editedExpense?.depreciation_years}
                  depreciationMethod={editedExpense?.depreciation_method}
                  onChange={(field, value) => {
                    setEditedExpense({ ...editedExpense, [field]: value });
                  }}
                />
              )}

              {/* Depreciation Info (View Mode) */}
              {!isEditing && expense.depreciation_type && expense.depreciation_type !== 'none' && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                    Depreciation (AfA)
                  </h3>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Type:</span> {expense.depreciation_type === 'immediate' ? 'Immediate Deduction' : 'Partial Depreciation'}
                    </p>
                    {expense.depreciation_type === 'partial' && (
                      <>
                        <p className="text-gray-700 dark:text-gray-300">
                          <span className="font-medium">Years:</span> {expense.depreciation_years}
                        </p>
                        <p className="text-gray-700 dark:text-gray-300">
                          <span className="font-medium">Method:</span> {expense.depreciation_method}
                        </p>
                      </>
                    )}
                    {expense.tax_deductible_amount && (
                      <p className="text-amber-700 dark:text-amber-300 font-medium mt-2">
                        Tax Deductible This Year: {formatCurrency(expense.tax_deductible_amount, expense.currency)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Tax Deductibility Info (View Mode) */}
              {!isEditing && expense.tax_deductible_percentage !== null && expense.tax_deductible_percentage !== undefined && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                    Tax Deductibility
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Deductible Percentage:</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-300">
                        {expense.tax_deductible_percentage}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Deductible Amount:</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-300">
                        {formatCurrency(
                          (parseFloat(expense.net_amount?.toString() || '0') * expense.tax_deductible_percentage) / 100,
                          expense.currency
                        )}
                      </span>
                    </div>
                    {expense.tax_deductibility_reasoning && (
                      <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                        <p className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-1">
                          AI Analysis:
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 text-xs leading-relaxed">
                          {expense.tax_deductibility_reasoning}
                        </p>
                      </div>
                    )}
                    {expense.tax_deductibility_analysis_date && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Analyzed: {new Date(expense.tax_deductibility_analysis_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* AI Depreciation Analysis - Only show in edit mode */}
              {expense && isEditing && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <DepreciationAnalysisSection
                    expenseId={expenseId}
                    netAmount={parseFloat(expense.net_amount?.toString() || '0')}
                    expenseDate={expense.expense_date}
                    existingAnalysis={expense.ai_analysis_response ? JSON.stringify(expense.ai_analysis_response) : null}
                    onSuccess={onExpenseUpdated}
                    isEditing={isEditing}
                    onApplyToForm={(settings) => {
                      if (isEditing && editedExpense) {
                        setEditedExpense({
                          ...editedExpense,
                          depreciation_type: settings.depreciation_type,
                          depreciation_years: settings.depreciation_years,
                          depreciation_start_date: settings.depreciation_start_date,
                          depreciation_method: settings.depreciation_method,
                          useful_life_category: settings.useful_life_category,
                          category: settings.category || editedExpense.category, // Apply AI-suggested category
                          tax_deductible_percentage: settings.tax_deductible_percentage,
                          tax_deductibility_reasoning: settings.tax_deductibility_reasoning,
                        });
                      }
                    }}
                  />
                </div>
              )}

              {/* Tags */}
              {expense.tags && expense.tags.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Tags
                  </label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {expense.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                    </div>
                  )}

            </div>

            {/* Addon injection point: expense detail actions
                Addons receive the full expense object and update callback.
                Use this slot for per-expense analysis buttons, export actions, etc. */}
            {expense && (
              <Slot
                name="expense-detail-actions"
                context={{ expense, onExpenseUpdated, isEditing }}
              />
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            Expense not found
          </div>
        )}
      </Modal>

      {/* Receipt Preview Modal */}
      {showReceiptPreview && expense?.receipt_url && isImage(expense.receipt_mimetype) && (
        <Modal
          open={showReceiptPreview}
          onClose={() => setShowReceiptPreview(false)}
          title={expense.receipt_filename || 'Receipt Preview'}
          size="xl"
        >
          <div className="flex justify-center bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
            {receiptPreviewUrl ? (
              <img
                src={receiptPreviewUrl}
                alt="Receipt"
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            ) : (
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
