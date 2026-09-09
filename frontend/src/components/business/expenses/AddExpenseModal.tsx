import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateExpense } from '@/hooks/api/useExpenses';
import { useProjects } from '@/hooks/api/useProjects';
import { ExpenseCategory } from '@/api/types';
import { Input, CustomSelect, Textarea } from '@/components/forms';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/common/Button';
import { useUploadReceipt } from '@/hooks/api/useExpenses';
import { analyzeReceipt } from '@/api/services/expense.service';
import type { AnalyzedLineItem } from '@/api/services/expense.service';
import { DepreciationSettings } from '@/components/business/expenses/DepreciationSettings';
import { useAnalyzeDepreciationDraft } from '@/hooks/api/useDepreciation';
import { Slot } from '@/plugins/slots';
import { usePlugins } from '@/api/hooks/usePlugins';
import { extractErrorMessage } from '../../../utils/error';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseAdded: () => void;
}

export function AddExpenseModal({ isOpen, onClose, onExpenseAdded }: AddExpenseModalProps) {
  const { t } = useTranslation('expenses');
  const { data: pluginsData } = usePlugins();
  const aiAddonEnabled = pluginsData?.plugins?.find((p) => p.name === 'ai-expense-analysis')?.userEnabled ?? false;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [category, setCategory] = useState<string>('software');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [projectId, setProjectId] = useState<string>('');
  const [isBillable, setIsBillable] = useState(false);
  const [isReimbursable, setIsReimbursable] = useState(false);
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  // Set once the receipt analysis succeeds, so the modal can offer the AfA
  // analysis right away instead of making the user save and reopen the expense.
  const [offerDepreciationAnalysis, setOfferDepreciationAnalysis] = useState(false);
  const [depreciationMessage, setDepreciationMessage] = useState<string | null>(null);
  // Positions of a bundled invoice. Non-empty only when the receipt covers
  // several distinct articles, which have to be booked separately: the GWG
  // limit and the AfA useful life both apply per article, not per invoice.
  const [lineItems, setLineItems] = useState<AnalyzedLineItem[]>([]);
  const [selectedLineItems, setSelectedLineItems] = useState<boolean[]>([]);
  const [splitProgress, setSplitProgress] = useState<string | null>(null);
  const [isSplitting, setIsSplitting] = useState(false);
  
  // Recurring expense fields
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('monthly');
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');

  // Depreciation fields
  const [depreciationType, setDepreciationType] = useState<'none' | 'immediate' | 'partial' | null>('none');
  const [depreciationYears, setDepreciationYears] = useState<number | null>(null);
  const [depreciationMethod, setDepreciationMethod] = useState<'linear' | 'degressive' | null>('linear');
  const [depreciationCategory, setDepreciationCategory] = useState<string | null>(null);

  // Calculate tax breakdown
  const totalAmount = parseFloat(amount) || 0;
  const taxRatePercent = parseFloat(taxRate) || 0;
  const taxMultiplier = 1 + (taxRatePercent / 100);
  const netAmount = totalAmount / taxMultiplier;
  const taxAmount = totalAmount - netAmount;

  const createExpense = useCreateExpense();
  const uploadReceipt = useUploadReceipt();
  const analyzeDepreciationDraft = useAnalyzeDepreciationDraft();
  const { data: projects = [] } = useProjects();

  useEffect(() => {
    if (!isOpen) {
      // Reset form when modal closes
      setDescription('');
      setAmount('');
      setTaxRate('0');
      setCategory('software');
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setProjectId('');
      setIsBillable(false);
      setIsReimbursable(false);
      setNotes('');
      setCurrency('EUR');
      setReceiptFile(null);
      setAnalysisMessage(null);
      setOfferDepreciationAnalysis(false);
      setDepreciationMessage(null);
      setLineItems([]);
      setSelectedLineItems([]);
      setSplitProgress(null);
      setIsSplitting(false);
      setIsRecurring(false);
      setRecurrenceFrequency('monthly');
      setRecurrenceStartDate(new Date().toISOString().split('T')[0]);
      setRecurrenceEndDate('');
      setDepreciationType('none');
      setDepreciationYears(null);
      setDepreciationMethod('linear');
      setDepreciationCategory(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // First create the expense
      const expenseData: any = {
        description,
        amount: parseFloat(amount),
        net_amount: parseFloat(netAmount.toFixed(2)),
        tax_rate: parseFloat(taxRate) / 100, // Convert percentage to decimal (19 -> 0.19)
        tax_amount: parseFloat(taxAmount.toFixed(2)),
        category: category as ExpenseCategory,
        expense_date: expenseDate,
        project_id: projectId || null,
        is_billable: isBillable,
        is_reimbursable: isReimbursable,
        notes: notes || null,
        currency,
      };

      // Only add recurring fields if recurring is enabled
      if (isRecurring) {
        expenseData.is_recurring = true;
        expenseData.recurrence_frequency = recurrenceFrequency;
        expenseData.recurrence_start_date = recurrenceStartDate;
        expenseData.recurrence_end_date = recurrenceEndDate || null;
      }

      // Add depreciation fields if not 'none'
      if (depreciationType && depreciationType !== 'none') {
        expenseData.depreciation_type = depreciationType;
        expenseData.depreciation_method = depreciationMethod;
        expenseData.useful_life_category = depreciationCategory; // Backend expects useful_life_category
        if (depreciationType === 'partial' && depreciationYears) {
          expenseData.depreciation_years = depreciationYears;
        }
      }

      const newExpense = await createExpense.mutateAsync(expenseData);

      // Then upload receipt if provided
      if (receiptFile && newExpense.id) {
        await uploadReceipt.mutateAsync({
          expenseId: newExpense.id,
          file: receiptFile,
        });
      }

      onExpenseAdded();
      onClose();
    } catch (error) {
      console.error('Failed to create expense:', error);
      // Log the full error details
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as any;
        console.error('Response data:', axiosError.response?.data);
        console.error('Response status:', axiosError.response?.status);
      }
    }
  };

  const handleAnalyzeReceipt = async () => {
    if (!receiptFile) {
      setAnalysisMessage('Please select a PDF file first');
      return;
    }

    if (!isAnalysable(receiptFile)) {
      setAnalysisMessage(
        t('ai.unsupportedType', 'Only PDFs and images (JPEG, PNG, WebP) can be analyzed')
      );
      return;
    }

    setIsAnalyzing(true);
    setAnalysisMessage(null);

    try {
      const result = await analyzeReceipt(receiptFile);

      if (result.success && result.data) {
        const extracted = result.data;

        // Pre-fill form with extracted data.
        // `description` is the only field shown in the expense overview, so it has
        // to carry what was actually bought. Vendor, seller and invoice number are
        // supporting context and go to the notes instead.
        if (extracted.amount) setAmount(extracted.amount.toString());
        if (extracted.date) setExpenseDate(extracted.date);

        const label = extracted.description?.trim() || extracted.vendor?.trim();
        if (label) setDescription(label);

        // Only accept a category the select can actually display.
        if (extracted.category && categoryOptions.some((o) => o.value === extracted.category)) {
          setCategory(extracted.category);
        }

        const context = [
          extracted.vendor && `${t('ai.vendor', 'Vendor')}: ${extracted.vendor}`,
          extracted.seller &&
            extracted.seller !== extracted.vendor &&
            `${t('ai.seller', 'Sold by')}: ${extracted.seller}`,
          extracted.invoice_number &&
            `${t('ai.invoiceNumber', 'Invoice no.')}: ${extracted.invoice_number}`,
        ].filter(Boolean);
        if (context.length) setNotes(context.join('\n'));

        if (extracted.currency) setCurrency(extracted.currency);
        if (extracted.tax_rate) setTaxRate((extracted.tax_rate * 100).toString());

        const confidence = result.data.confidence || 0;
        setAnalysisMessage(
          `✓ Analysis complete! Confidence: ${confidence}%. Please review and adjust the extracted data.`
        );
        // A bundled invoice has to be booked per article, so offer the split
        // instead of the single-expense AfA shortcut.
        const items = extracted.line_items ?? [];
        setLineItems(items);
        setSelectedLineItems(items.map(() => true));
        setSplitProgress(null);

        // Everything the AfA analysis needs is now in the form, so offer it here
        // rather than after a save/reopen round trip.
        setDepreciationMessage(null);
        setOfferDepreciationAnalysis(items.length === 0 && Boolean(label && extracted.amount));
      } else {
        setAnalysisMessage(result.message || 'Analysis failed. Please fill in the form manually.');
      }
    } catch (error) {
      console.error('Failed to analyze receipt:', error);
      setAnalysisMessage(`✗ Analysis failed: ${extractErrorMessage(error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Run the AfA analysis on the values currently in the form.
   *
   * Uses the draft endpoint so no expense has to exist yet — the recommendation
   * is applied to the depreciation fields and saved together with everything
   * else when the user submits.
   */
  const handleAnalyzeDepreciation = async () => {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setDepreciationMessage(
        t('ai.depreciationNeedsData', 'Please fill in a description and amount first.')
      );
      return;
    }

    setDepreciationMessage(null);

    try {
      const result = await analyzeDepreciationDraft.mutateAsync({
        description,
        notes,
        category,
        amount: parsedAmount,
        net_amount: parseFloat(netAmount.toFixed(2)),
        tax_amount: parseFloat(taxAmount.toFixed(2)),
        tax_rate: parseFloat(taxRate) / 100,
        expense_date: expenseDate,
      });

      const analysis = result.analysis;
      if (!analysis) {
        setDepreciationMessage(
          result.reason || t('ai.depreciationNoResult', 'No depreciation recommendation returned.')
        );
        return;
      }

      setDepreciationType(analysis.depreciation_type);
      setDepreciationYears(analysis.depreciation_years ?? null);
      setDepreciationCategory(analysis.useful_life_category ?? null);

      // The AfA analysis reasons about the asset itself and often lands on a
      // better category than the receipt extraction did.
      if (
        analysis.suggested_category &&
        categoryOptions.some((o) => o.value === analysis.suggested_category)
      ) {
        setCategory(analysis.suggested_category);
      }

      setOfferDepreciationAnalysis(false);
      setDepreciationMessage(
        `✓ ${t('ai.depreciationDone', 'Depreciation analysis complete')} (${analysis.confidence}%): ${analysis.reasoning}`
      );
    } catch (error) {
      console.error('Failed to analyze depreciation:', error);
      setDepreciationMessage(
        `✗ ${t('ai.depreciationFailed', 'Depreciation analysis failed')}: ${
          extractErrorMessage(error)
        }`
      );
    }
  };

  /**
   * Whether a receipt can be sent to the AI analysis.
   *
   * The MCP server reads photographed and scanned receipts as well as PDFs, so
   * images qualify too. Mirrors ANALYSABLE_TYPES in expense-receipt.controller.
   */
  const isAnalysable = (file: File) =>
    file.type === 'application/pdf' || /^image\/(jpeg|jpg|png|webp)$/.test(file.type);

  /** Gross total of the positions the user has ticked. */
  const selectedLineItemTotal = lineItems.reduce(
    (sum, item, index) => (selectedLineItems[index] ? sum + item.amount : sum),
    0
  );
  const selectedLineItemCount = selectedLineItems.filter(Boolean).length;
  // The extraction is told the positions must add up to the invoice total, but
  // it is still a language model — show the user when they do not.
  const lineItemsReconcile =
    lineItems.length > 0 &&
    Math.abs(lineItems.reduce((sum, i) => sum + i.amount, 0) - (parseFloat(amount) || 0)) < 0.02;

  const toggleLineItem = (index: number) => {
    setSelectedLineItems((prev) => prev.map((v, i) => (i === index ? !v : v)));
  };

  /**
   * Book one expense per ticked invoice position.
   *
   * Each position becomes its own expense so it gets its own GWG/AfA treatment,
   * and the receipt PDF is attached to every one of them so each row carries its
   * own proof. Runs sequentially — a partial failure reports how far it got
   * rather than silently leaving a half-booked invoice behind.
   */
  const handleCreateSplitExpenses = async () => {
    const chosen = lineItems.filter((_, index) => selectedLineItems[index]);
    if (chosen.length === 0) return;

    setIsSplitting(true);
    setSplitProgress(null);

    let created = 0;
    try {
      for (const item of chosen) {
        setSplitProgress(
          t('ai.splitProgress', 'Creating expense {{current}} of {{total}}...', {
            current: created + 1,
            total: chosen.length,
          })
        );

        const itemTaxRate = item.tax_rate ?? (parseFloat(taxRate) / 100 || 0);
        const itemNet = item.amount / (1 + itemTaxRate);
        const quantity = item.quantity && item.quantity > 1 ? item.quantity : 1;

        const itemNotes = [
          notes,
          quantity > 1 && item.unit_amount
            ? `${quantity} x ${item.unit_amount.toFixed(2)} ${currency}`
            : null,
        ]
          .filter(Boolean)
          .join('\n');

        const newExpense = await createExpense.mutateAsync({
          description: quantity > 1 ? `${quantity}x ${item.description}` : item.description,
          amount: item.amount,
          net_amount: parseFloat(itemNet.toFixed(2)),
          tax_rate: itemTaxRate,
          tax_amount: parseFloat((item.amount - itemNet).toFixed(2)),
          category: (item.category || category) as ExpenseCategory,
          expense_date: expenseDate,
          project_id: projectId || null,
          is_billable: isBillable,
          is_reimbursable: isReimbursable,
          notes: itemNotes || null,
          currency,
        } as any);

        // Attach the receipt to every expense so each one stands on its own.
        if (receiptFile && newExpense.id) {
          await uploadReceipt.mutateAsync({ expenseId: newExpense.id, file: receiptFile });
        }
        created += 1;
      }

      onExpenseAdded();
      onClose();
    } catch (error) {
      console.error('Failed to create split expenses:', error);
      setSplitProgress(
        `✗ ${t('ai.splitFailed', 'Created {{created}} of {{total}} expenses, then failed', {
          created,
          total: chosen.length,
        })}: ${extractErrorMessage(error)}`
      );
      if (created > 0) onExpenseAdded();
    } finally {
      setIsSplitting(false);
    }
  };

  const formId = 'add-expense-form';

  const categoryOptions = [
    // IT & Digital Equipment
    { value: 'computer', label: t('categories.computer', 'Computer/Laptop/Tablet') },
    { value: 'software', label: t('categories.software', 'Software & Licenses') },
    { value: 'peripherals', label: t('categories.peripherals', 'Peripherals') },
    { value: 'storage', label: t('categories.storage', 'Storage Devices') },
    { value: 'display', label: t('categories.display', 'Monitor/Display') },
    { value: 'printer', label: t('categories.printer', 'Printer/Scanner') },
    
    // Office
    { value: 'office_furniture', label: t('categories.office_furniture', 'Office Furniture') },
    { value: 'office_equipment', label: t('categories.office_equipment', 'Office Equipment') },
    { value: 'office_supplies', label: t('categories.office_supplies', 'Office Supplies') },
    
    // Vehicles
    { value: 'vehicle_car', label: t('categories.vehicle_car', 'Car/Vehicle') },
    { value: 'vehicle_motorcycle', label: t('categories.vehicle_motorcycle', 'Motorcycle/E-bike') },
    
    // Tools
    { value: 'camera', label: t('categories.camera', 'Camera Equipment') },
    { value: 'tools', label: t('categories.tools', 'Tools/Equipment') },
    { value: 'machinery', label: t('categories.machinery', 'Machinery') },
    
    // Services & Operating Expenses
    { value: 'insurance', label: t('categories.insurance', 'Insurance') },
    { value: 'professional_services', label: t('categories.professional_services', 'Professional Services') },
    { value: 'marketing', label: t('categories.marketing', 'Marketing') },
    { value: 'utilities', label: t('categories.utilities', 'Utilities') },
    { value: 'travel', label: t('categories.travel', 'Travel') },
    { value: 'meals', label: t('categories.meals', 'Meals') },
    { value: 'training', label: t('categories.training', 'Training') },
    { value: 'rent', label: t('categories.rent', 'Rent') },
    { value: 'telecommunications', label: t('categories.telecommunications', 'Phone/Internet') },
    
    { value: 'other', label: t('categories.other', 'Other') },
  ];

  const projectOptions = [
    { value: '', label: t('noProject') },
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  const currencyOptions = [
    { value: 'EUR', label: 'EUR (€)' },
    { value: 'USD', label: 'USD ($)' },
    { value: 'GBP', label: 'GBP (£)' },
  ];

  const taxRateOptions = [
    { value: '0', label: t('tax.noTax') + ' (0%)' },
    { value: '7', label: t('tax.reducedRate') + ' (7%)' },
    { value: '19', label: t('tax.standardRate') + ' (19%)' },
  ];

  const getCurrencySymbol = () => {
    switch (currency) {
      case 'USD': return '$';
      case 'GBP': return '£';
      case 'EUR':
      default: return '€';
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t('add')}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={createExpense.isPending}>
            {createExpense.isPending ? t('adding') : t('addExpense')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
                {/* Description */}
                <Input
                  label={t('fields.description')}
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('fields.descriptionPlaceholder')}
                  required
                />

                {/* Amount and Currency */}
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('fields.amount')}
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                  <CustomSelect
                    label={t('fields.currency')}
                    value={currency}
                    onChange={setCurrency}
                    options={currencyOptions}
                  />
                </div>

                {/* Tax Rate */}
                <CustomSelect
                  label={t('tax.taxRate')}
                  value={taxRate}
                  onChange={setTaxRate}
                  options={taxRateOptions}
                />

                {/* Tax Breakdown Display */}
                {totalAmount > 0 && (
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                      {t('tax.breakdown')}
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">{t('tax.netAmount')}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {netAmount.toFixed(2)} {getCurrencySymbol()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          {t('tax.taxAmount')} ({taxRatePercent}%)
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {taxAmount.toFixed(2)} {getCurrencySymbol()}
                        </span>
                      </div>
                      <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2"></div>
                      <div className="flex justify-between">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{t('tax.total')}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {totalAmount.toFixed(2)} {getCurrencySymbol()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Category and Date */}
                <div className="grid grid-cols-2 gap-4">
                  <CustomSelect
                    label={t('fields.category')}
                    value={category}
                    onChange={setCategory}
                    options={categoryOptions}
                  />
                  <Input
                    label={t('fields.date')}
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required
                  />
                </div>

                {/* Project */}
                <CustomSelect
                  label={t('fields.project')}
                  value={projectId}
                  onChange={setProjectId}
                  options={projectOptions}
                />

                {/* Checkboxes */}
                <div className="flex gap-6">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isBillable}
                      onChange={(e) => setIsBillable(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {t('billableToClient')}
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isReimbursable}
                      onChange={(e) => setIsReimbursable(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {t('fields.isReimbursable')}
                    </span>
                  </label>
                </div>

                {/* Recurring Expense Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <label className="flex items-center mb-4">
                    <input
                      type="checkbox"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('recurring.isRecurring', 'Recurring Expense')}
                    </span>
                  </label>

                  {isRecurring && (
                    <div className="space-y-4 pl-6 border-l-2 border-purple-200 dark:border-purple-800">
                      {/* Frequency */}
                      <CustomSelect
                        label={t('recurring.frequency', 'Frequency')}
                        value={recurrenceFrequency}
                        onChange={setRecurrenceFrequency}
                        options={[
                          { value: 'monthly', label: t('recurring.monthly', 'Monthly') },
                          { value: 'quarterly', label: t('recurring.quarterly', 'Quarterly') },
                          { value: 'yearly', label: t('recurring.yearly', 'Yearly') },
                        ]}
                      />

                      {/* Start and End Dates */}
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label={t('recurring.startDate', 'Start Date')}
                          type="date"
                          value={recurrenceStartDate}
                          onChange={(e) => setRecurrenceStartDate(e.target.value)}
                          required
                        />
                        <Input
                          label={t('recurring.endDate', 'End Date (Optional)')}
                          type="date"
                          value={recurrenceEndDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          min={recurrenceStartDate}
                        />
                      </div>

                      {/* Info Box */}
                      <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 p-3 border border-purple-200 dark:border-purple-800">
                        <p className="text-xs text-purple-800 dark:text-purple-300">
                          💡 {t('recurring.info', 'This expense will be automatically generated based on the selected frequency. The system runs daily at 2 AM to create new expense entries.')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Depreciation Settings */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <DepreciationSettings
                    depreciationType={depreciationType}
                    depreciationYears={depreciationYears}
                    depreciationMethod={depreciationMethod}
                    onChange={(field, value) => {
                      if (field === 'depreciation_type') {
                        setDepreciationType(value);
                      } else if (field === 'depreciation_years') {
                        setDepreciationYears(value);
                      } else if (field === 'depreciation_method') {
                        setDepreciationMethod(value);
                      }
                    }}
                  />
                </div>

                {/* Notes */}
                <Textarea
                  label={t('fields.notes')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('notesPlaceholder')}
                  rows={3}
                />

                {/* Receipt Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('fields.receipt')}
                  </label>
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-900 dark:text-gray-100 
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-md file:border-0
                                file:text-sm file:font-medium
                                file:bg-purple-50 file:text-purple-700
                                hover:file:bg-purple-100
                                dark:file:bg-purple-900/30 dark:file:text-purple-400
                                dark:hover:file:bg-purple-900/50
                                cursor-pointer"
                    />
                    {receiptFile && isAnalysable(receiptFile) && aiAddonEnabled && (
                      <button
                        type="button"
                        onClick={handleAnalyzeReceipt}
                        disabled={isAnalyzing}
                        className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 
                                   rounded-lg hover:from-purple-700 hover:to-indigo-700 
                                   disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed
                                   transition-all duration-200 shadow-sm hover:shadow-md
                                   flex items-center gap-2"
                      >
                        {isAnalyzing ? (
                          <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            🤖 {t('ai.analyzeReceipt', 'Analyze Receipt with AI')}
                          </>
                        )}
                      </button>
                    )}
                    {analysisMessage && (
                      <p className={`text-sm ${analysisMessage.startsWith('✓') ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {analysisMessage}
                      </p>
                    )}
                    {lineItems.length > 0 && (
                      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-3">
                        <div>
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                            {t('ai.splitTitle', 'This invoice contains {{count}} positions', {
                              count: lineItems.length,
                            })}
                          </p>
                          <p className="text-xs text-blue-800 dark:text-blue-200 mt-1">
                            {t(
                              'ai.splitHint',
                              'The 800 EUR GWG limit and the depreciation period apply per article, not per invoice. Book them separately to get the tax treatment right.'
                            )}
                          </p>
                        </div>

                        <div className="space-y-1">
                          {lineItems.map((item, index) => (
                            <label
                              key={`${item.description}-${index}`}
                              className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedLineItems[index] ?? false}
                                onChange={() => toggleLineItem(index)}
                                disabled={isSplitting}
                                className="mt-1 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                              />
                              <span className="flex-1">
                                {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}
                                {item.description}
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {' '}— {item.amount.toFixed(2)} {currency}
                                  {item.category ? ` · ${item.category}` : ''}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>

                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          {t('ai.splitSelected', 'Selected')}: {selectedLineItemTotal.toFixed(2)} {currency}
                          {' · '}
                          {lineItemsReconcile
                            ? t('ai.splitReconciles', 'positions match the invoice total')
                            : t(
                                'ai.splitMismatch',
                                'positions do NOT add up to the invoice total — check them'
                              )}
                        </p>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={handleCreateSplitExpenses}
                            disabled={isSplitting || selectedLineItemCount === 0}
                          >
                            {isSplitting
                              ? t('ai.splitRunning', 'Creating...')
                              : t('ai.splitCreate', 'Create {{count}} expenses', {
                                  count: selectedLineItemCount,
                                })}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setLineItems([]);
                              setSelectedLineItems([]);
                              setOfferDepreciationAnalysis(Boolean(description && amount));
                            }}
                            disabled={isSplitting}
                          >
                            {t('ai.splitCombined', 'Keep as one expense')}
                          </Button>
                        </div>

                        {splitProgress && (
                          <p className={`text-sm ${splitProgress.startsWith('✗') ? 'text-red-600 dark:text-red-400' : 'text-blue-800 dark:text-blue-200'}`}>
                            {splitProgress}
                          </p>
                        )}
                      </div>
                    )}
                    {offerDepreciationAnalysis && aiAddonEnabled && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
                        <p className="text-sm text-amber-900 dark:text-amber-100">
                          {t(
                            'ai.depreciationPrompt',
                            'Analyze depreciation (AfA) for this expense now as well?'
                          )}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={handleAnalyzeDepreciation}
                            disabled={analyzeDepreciationDraft.isPending}
                          >
                            {analyzeDepreciationDraft.isPending
                              ? t('ai.depreciationRunning', 'Analyzing depreciation...')
                              : t('ai.depreciationYes', 'Yes, analyze now')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOfferDepreciationAnalysis(false)}
                            disabled={analyzeDepreciationDraft.isPending}
                          >
                            {t('ai.depreciationNo', 'Skip')}
                          </Button>
                        </div>
                      </div>
                    )}
                    {depreciationMessage && (
                      <p className={`text-sm ${depreciationMessage.startsWith('✓') ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {depreciationMessage}
                      </p>
                    )}
                    {receiptFile && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('receiptSelected')}:{' '}
                        <button
                          type="button"
                          onClick={() => {
                            const url = URL.createObjectURL(receiptFile);
                            window.open(url, '_blank');
                          }}
                          className="text-purple-600 dark:text-purple-400 hover:underline cursor-pointer font-medium"
                        >
                          {receiptFile.name}
                        </button>
                        {' '}({(receiptFile.size / 1024).toFixed(2)} KB)
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('receiptMaxSize')}
                    </p>
                  </div>
                </div>

        {/* Addon injection point: expense form actions
            Addons can render buttons or sections here (e.g., AI receipt scan).
            Context provides form field setters so addons can pre-fill the form. */}
        <Slot
          name="expense-form-actions"
          context={{
            setDescription,
            setAmount,
            setCurrency,
            setCategory,
            setExpenseDate,
            setNotes,
          }}
        />
      </form>
    </Modal>
  );
}
