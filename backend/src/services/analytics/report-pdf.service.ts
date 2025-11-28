/**
 * @fileoverview Professional PDF export service using pdfmake for German tax reports.
 * Matches standard EÜR (Einnahmen-Überschuss-Rechnung) format.
 * @module services/analytics/report-pdf.service
 */

import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import moment from 'moment-timezone';
import type { 
  VATReport, 
  IncomeExpenseReport, 
  InvoiceReport, 
  ExpenseReport,
  TimeTrackingReport
} from './report.service';

// Fonts configuration for pdfmake
const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const COLORS = {
  primary: '#7c3aed',
  headerBg: '#f3f4f6',
  border: '#e5e7eb',
  text: '#1f2937',
};

// Translations
const translations = {
  en: {
    vatReport: 'VAT Report',
    incomeExpenseReport: 'Income & Expense Report',
    invoiceReport: 'Invoice Report',
    expenseReport: 'Expense Report',
    period: 'Period',
    revenue: 'Revenue',
    expenses: 'Expenses',
    summary: 'Summary',
    outputVAT: 'Output VAT',
    inputVAT: 'Input VAT',
    vatPayable: 'VAT Payable',
    vatRefund: 'VAT Refund',
    totalIncome: 'Total Income',
    totalExpenses: 'Total Expenses',
    profitLoss: 'Profit/Loss',
    invoiceNumber: 'Invoice #',
    client: 'Client',
    issueDate: 'Issue Date',
    dueDate: 'Due Date',
    status: 'Status',
    paidAmount: 'Paid',
    outstanding: 'Outstanding',
    category: 'Category',
    description: 'Description',
    amount: 'Amount',
    date: 'Date',
    netAmount: 'Net',
    vatAmount: 'VAT',
    grossAmount: 'Gross',
    total: 'Total',
    generatedOn: 'Generated on',
    page: 'Page',
    of: 'of',
    receiptNo: 'Receipt #',
    vendor: 'Vendor',
    project: 'Project',
    billable: 'Billable',
    yes: 'Yes',
    no: 'No',
    taxRate: 'Tax Rate',
  },
  de: {
    vatReport: 'Umsatzsteuerbericht',
    incomeExpenseReport: 'Finanzanalyse',
    invoiceReport: 'Rechnungsbericht',
    expenseReport: 'Ausgabenbericht',
    period: 'Zeitraum',
    revenue: 'Umsatz',
    expenses: 'Ausgaben',
    summary: 'Zusammenfassung',
    outputVAT: 'Ausgangsumsatzsteuer',
    inputVAT: 'Vorsteuer',
    vatPayable: 'Zahlbare USt.',
    vatRefund: 'USt. Erstattung',
    totalIncome: 'Gesamteinnahmen',
    totalExpenses: 'Gesamtausgaben',
    profitLoss: 'Gewinn/Verlust',
    invoiceNumber: 'Rechnungs-Nr.',
    client: 'Kunde',
    issueDate: 'Ausstellungsdatum',
    dueDate: 'Fälligkeitsdatum',
    status: 'Status',
    paidAmount: 'Bezahlt',
    outstanding: 'Ausstehend',
    category: 'Kategorie',
    description: 'Beschreibung',
    amount: 'Betrag',
    date: 'Datum',
    netAmount: 'Netto',
    vatAmount: 'USt.',
    grossAmount: 'Gesamt',
    total: 'Gesamt',
    generatedOn: 'Erstellt am',
    page: 'Seite',
    of: 'von',
    receiptNo: 'Beleg-Nr.',
    vendor: 'Lieferant',
    project: 'Projekt',
    billable: 'Verrechenbar',
    yes: 'Ja',
    no: 'Nein',
    taxRate: 'Steuersatz',
  },
};

type Language = 'en' | 'de';

const t = (lang: Language, key: keyof typeof translations.en): string => {
  return translations[lang][key] || translations.en[key];
};

const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat(currency === 'EUR' ? 'de-DE' : 'en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};

const formatDate = (date: string, lang: Language): string => {
  return moment(date).format(lang === 'de' ? 'DD.MM.YYYY' : 'MM/DD/YYYY');
};

/**
 * Generate header for each page
 */
const createHeader = (title: string, lang: Language, dateRange: string): Content => {
  return {
    margin: [40, 30, 40, 20],
    stack: [
      {
        text: title,
        style: 'header',
        color: COLORS.primary,
        fontSize: 20,
        bold: true,
      },
      {
        text: `${t(lang, 'period')}: ${dateRange}`,
        style: 'subheader',
        fontSize: 10,
        color: COLORS.text,
        margin: [0, 5, 0, 0],
      },
    ],
  };
};

/**
 * Generate footer for each page with page numbers
 */
const createFooter = (currentPage: number, pageCount: number, lang: Language): Content => {
  const timestamp = moment().format(lang === 'de' ? 'DD.MM.YYYY, HH:mm:ss' : 'MM/DD/YYYY, hh:mm:ss A');
  return {
    margin: [40, 10, 40, 20],
    columns: [
      {
        text: `${t(lang, 'generatedOn')}: ${timestamp}`,
        fontSize: 8,
        color: '#666',
      },
      {
        text: `${t(lang, 'page')} ${currentPage} ${t(lang, 'of')} ${pageCount}`,
        fontSize: 8,
        color: '#666',
        alignment: 'right',
      },
    ],
  };
};

/**
 * Generate VAT Report PDF
 */
async function generateVATReportPDF(
  data: VATReport,
  currency: string,
  lang: Language = 'en'
): Promise<Buffer> {
  const dateRange = `${formatDate(data.period.start_date, lang)} - ${formatDate(data.period.end_date, lang)}`;

  // Summary boxes
  const summaryBoxes: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: t(lang, 'outputVAT'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.revenue_vat, currency), fontSize: 16, bold: true, color: COLORS.primary },
          ],
          margin: [0, 0, 10, 0],
        },
        {
          width: '*',
          stack: [
            { text: t(lang, 'inputVAT'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.expense_vat, currency), fontSize: 16, bold: true, color: '#ef4444' },
          ],
          margin: [0, 0, 10, 0],
        },
        {
          width: '*',
          stack: [
            { text: data.summary.vat_payable >= 0 ? t(lang, 'vatPayable') : t(lang, 'vatRefund'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(Math.abs(data.summary.vat_payable), currency), fontSize: 16, bold: true, color: data.summary.vat_payable >= 0 ? '#10b981' : '#f59e0b' },
          ],
        },
      ],
      margin: [0, 0, 0, 20],
    },
  ];

  // Revenue table by tax rate
  const revenueTableBody: TableCell[][] = [
    [
      { text: t(lang, 'taxRate'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'netAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'vatAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'grossAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  // Add 19% row
  if (data.revenue.gross_19 > 0) {
    revenueTableBody.push([
      { text: '19%', fontSize: 8 },
      { text: formatCurrency(data.revenue.net_19, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.revenue.vat_19, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.revenue.gross_19, currency), fontSize: 8, alignment: 'right' },
    ]);
  }

  // Add 7% row
  if (data.revenue.gross_7 > 0) {
    revenueTableBody.push([
      { text: '7%', fontSize: 8 },
      { text: formatCurrency(data.revenue.net_7, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.revenue.vat_7, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.revenue.gross_7, currency), fontSize: 8, alignment: 'right' },
    ]);
  }

  // Add 0% row
  if (data.revenue.gross_0 > 0) {
    revenueTableBody.push([
      { text: '0%', fontSize: 8 },
      { text: formatCurrency(data.revenue.gross_0, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(0, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.revenue.gross_0, currency), fontSize: 8, alignment: 'right' },
    ]);
  }

  // Revenue total row
  revenueTableBody.push([
    { text: t(lang, 'total'), fontSize: 9, bold: true, fillColor: COLORS.headerBg },
    { text: formatCurrency(data.revenue.total_net, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
    { text: formatCurrency(data.revenue.total_vat, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
    { text: formatCurrency(data.revenue.total_gross, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
  ]);

  // Expenses table by tax rate
  const expensesTableBody: TableCell[][] = [
    [
      { text: t(lang, 'taxRate'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'netAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'vatAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'grossAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  // Add 19% row
  if (data.expenses.gross_19 > 0) {
    expensesTableBody.push([
      { text: '19%', fontSize: 8 },
      { text: formatCurrency(data.expenses.net_19, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.expenses.vat_19, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.expenses.gross_19, currency), fontSize: 8, alignment: 'right' },
    ]);
  }

  // Add 7% row
  if (data.expenses.gross_7 > 0) {
    expensesTableBody.push([
      { text: '7%', fontSize: 8 },
      { text: formatCurrency(data.expenses.net_7, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.expenses.vat_7, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(data.expenses.gross_7, currency), fontSize: 8, alignment: 'right' },
    ]);
  }

  // Expenses total row
  expensesTableBody.push([
    { text: t(lang, 'total'), fontSize: 9, bold: true, fillColor: COLORS.headerBg },
    { text: formatCurrency(data.expenses.total_net, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
    { text: formatCurrency(data.expenses.total_vat, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
    { text: formatCurrency(data.expenses.total_gross, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
  ]);

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 90, 40, 60],
    header: (currentPage: number, pageCount: number) => createHeader(t(lang, 'vatReport'), lang, dateRange),
    footer: (currentPage: number, pageCount: number) => createFooter(currentPage, pageCount, lang),
    content: [
      ...summaryBoxes,
      {
        text: t(lang, 'revenue'),
        fontSize: 12,
        bold: true,
        margin: [0, 10, 0, 10],
        color: COLORS.primary,
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto'],
          body: revenueTableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
        },
        margin: [0, 0, 0, 20],
      },
      {
        text: t(lang, 'expenses'),
        fontSize: 12,
        bold: true,
        margin: [0, 10, 0, 10],
        color: COLORS.primary,
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto'],
          body: expensesTableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
        },
      },
    ],
    styles: {
      header: {
        fontSize: 20,
        bold: true,
      },
      subheader: {
        fontSize: 10,
      },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: COLORS.text,
      },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate comprehensive Income & Expense Report PDF (EÜR format)
 * Combines all transactions in one table like the official EÜR template
 */
async function generateIncomeExpenseReportPDF(
  data: IncomeExpenseReport,
  currency: string,
  lang: Language = 'en'
): Promise<Buffer> {
  const dateRange = `${formatDate(data.period.start_date, lang)} - ${formatDate(data.period.end_date, lang)}`;

  // Build 3 separate tables: Income, Expenses, and Tax Summary
  
  // ============ 1. INCOME TABLE (Betriebseinnahmen) ============
  const incomeTableBody: TableCell[][] = [
    [
      { text: 'Rechnungs-Nr.', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Kunde / Projekt', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Rechnungs-datum', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 7, bold: true, border: [true, true, true, true] },
      { text: 'Zahlungs-datum', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 7, bold: true, border: [true, true, true, true] },
      { text: 'Transaktions-ID', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 7, bold: true, border: [true, true, true, true] },
      { text: 'Netto', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'USt %', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'USt', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'Brutto', style: 'tableHeader', fillColor: '#bfdbfe', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
    ],
  ];

  let totalIncomeNetto = 0;
  let totalIncomeUst = 0;
  let totalIncomeBrutto = 0;

  data.income.transactions.forEach((invoice) => {
    totalIncomeNetto += invoice.net_amount;
    totalIncomeUst += invoice.tax_amount;
    totalIncomeBrutto += invoice.gross_amount;

    // Build client/project display: "Client Name (Project Name)" or just "Client Name"
    let clientProjectDisplay = invoice.client_name;
    if (invoice.project_name) {
      clientProjectDisplay += ` (${invoice.project_name})`;
    }

    incomeTableBody.push([
      { text: invoice.invoice_number, fontSize: 7, border: [true, true, true, true] },
      { text: clientProjectDisplay, fontSize: 7, border: [true, true, true, true] },
      { text: formatDate(invoice.issue_date, lang), fontSize: 7, border: [true, true, true, true] },
      { text: invoice.payment_date ? formatDate(invoice.payment_date, lang) : '-', fontSize: 7, border: [true, true, true, true] },
      { text: invoice.transaction_id || '-', fontSize: 6, border: [true, true, true, true] },
      { text: formatCurrency(invoice.net_amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: `${(invoice.tax_rate * 100).toFixed(1)}%`, fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: formatCurrency(invoice.tax_amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: formatCurrency(invoice.gross_amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
    ]);
  });

  // Add standalone payments (recurring project payments) to income table
  if (data.income.standalone_payments) {
    data.income.standalone_payments.forEach((payment) => {
      totalIncomeNetto += payment.amount; // Standalone payments are gross amounts (no tax breakdown)
      totalIncomeBrutto += payment.amount;

      // Build client/project display
      let clientProjectDisplay = payment.client_name;
      if (payment.project_name) {
        clientProjectDisplay += ` (${payment.project_name})`;
      }

      incomeTableBody.push([
        { text: payment.id.substring(0, 8), fontSize: 7, border: [true, true, true, true] },
        { text: clientProjectDisplay, fontSize: 7, border: [true, true, true, true] },
        { text: '-', fontSize: 7, border: [true, true, true, true] }, // No issue date for payments
        { text: formatDate(payment.payment_date, lang), fontSize: 7, border: [true, true, true, true] },
        { text: payment.notes || '-', fontSize: 6, border: [true, true, true, true] },
        { text: formatCurrency(payment.amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
        { text: '0.0%', fontSize: 7, alignment: 'right', border: [true, true, true, true] }, // No VAT on standalone payments
        { text: formatCurrency(0, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
        { text: formatCurrency(payment.amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      ]);
    });
  }

  // Income totals row
  incomeTableBody.push([
    { text: 'Gesamt Einnahmen', fontSize: 8, bold: true, colSpan: 5, fillColor: '#dbeafe', border: [true, true, true, true] },
    {},
    {},
    {},
    {},
    { text: formatCurrency(totalIncomeNetto, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#dbeafe', border: [true, true, true, true] },
    { text: '', fontSize: 8, fillColor: '#dbeafe', border: [true, true, true, true] },
    { text: formatCurrency(totalIncomeUst, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#dbeafe', border: [true, true, true, true] },
    { text: formatCurrency(totalIncomeBrutto, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#dbeafe', border: [true, true, true, true] },
  ]);

  // ============ 2. EXPENSES TABLE (Betriebsausgaben) ============
  const expenseTableBody: TableCell[][] = [
    [
      { text: 'Beleg-Nr.', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Beschreibung', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Kategorie', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Datum', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Netto', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'USt %', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'Vorsteuer', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'Brutto', style: 'tableHeader', fillColor: '#fecaca', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
    ],
  ];

  let totalExpenseNetto = 0;
  let totalExpenseUst = 0;
  let totalExpenseBrutto = 0;

  data.expenses.transactions.forEach((expense) => {
    totalExpenseNetto += expense.net_amount;
    totalExpenseUst += expense.tax_amount;
    totalExpenseBrutto += expense.amount;

    expenseTableBody.push([
      { text: expense.id.substring(0, 8), fontSize: 7, border: [true, true, true, true] },
      { text: expense.description, fontSize: 7, border: [true, true, true, true] },
      { text: expense.category, fontSize: 7, border: [true, true, true, true] },
      { text: formatDate(expense.expense_date, lang), fontSize: 7, border: [true, true, true, true] },
      { text: formatCurrency(expense.net_amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: `${(expense.tax_rate * 100).toFixed(1)}%`, fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: formatCurrency(expense.tax_amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
      { text: formatCurrency(expense.amount, currency), fontSize: 7, alignment: 'right', border: [true, true, true, true] },
    ]);
  });

  // Expenses totals row
  expenseTableBody.push([
    { text: 'Gesamt Ausgaben', fontSize: 8, bold: true, colSpan: 4, fillColor: '#fee2e2', border: [true, true, true, true] },
    {},
    {},
    {},
    { text: formatCurrency(totalExpenseNetto, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#fee2e2', border: [true, true, true, true] },
    { text: '', fontSize: 8, fillColor: '#fee2e2', border: [true, true, true, true] },
    { text: formatCurrency(totalExpenseUst, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#fee2e2', border: [true, true, true, true] },
    { text: formatCurrency(totalExpenseBrutto, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: '#fee2e2', border: [true, true, true, true] },
  ]);

  // ============ 3. TAX SUMMARY TABLE (Steuerübersicht) ============
  const taxTableBody: TableCell[][] = [
    [
      { text: 'Steuerart', style: 'tableHeader', fillColor: '#e5e7eb', fontSize: 8, bold: true, border: [true, true, true, true] },
      { text: 'Betrag', style: 'tableHeader', fillColor: '#e5e7eb', fontSize: 8, bold: true, alignment: 'right', border: [true, true, true, true] },
      { text: 'Beschreibung', style: 'tableHeader', fillColor: '#e5e7eb', fontSize: 8, bold: true, border: [true, true, true, true] },
    ],
  ];

  // Calculate tax summary
  const ustSchuld = totalIncomeUst; // VAT liability from income
  const vorsteuer = totalExpenseUst; // Input VAT from expenses
  const ustZahllast = ustSchuld - vorsteuer; // Net VAT payment before prepayments

  // Tax prepayments
  const vatPrepayments = data.tax_prepayments.vat_prepayments;
  const incomeTaxPrepayments = data.tax_prepayments.income_tax_prepayments;
  const totalPrepayments = data.tax_prepayments.total_prepayments;

  // Net position after prepayments
  const ustNetPosition = ustZahllast - vatPrepayments;

  taxTableBody.push([
    { text: 'Umsatzsteuer (USt-Schuld)', fontSize: 8, border: [true, true, true, true] },
    { text: formatCurrency(ustSchuld, currency), fontSize: 8, alignment: 'right', border: [true, true, true, true] },
    { text: 'Aus Einnahmen zu zahlende USt', fontSize: 7, border: [true, true, true, true] },
  ]);

  taxTableBody.push([
    { text: 'Vorsteuer (abziehbar)', fontSize: 8, border: [true, true, true, true] },
    { text: formatCurrency(vorsteuer, currency), fontSize: 8, alignment: 'right', border: [true, true, true, true] },
    { text: 'Aus Ausgaben abziehbare Vorsteuer', fontSize: 7, border: [true, true, true, true] },
  ]);

  taxTableBody.push([
    { text: 'USt-Zahllast / Erstattung', fontSize: 8, bold: true, fillColor: ustZahllast >= 0 ? '#fee2e2' : '#d1fae5', border: [true, true, true, true] },
    { text: formatCurrency(ustZahllast, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: ustZahllast >= 0 ? '#fee2e2' : '#d1fae5', border: [true, true, true, true] },
    { text: ustZahllast >= 0 ? 'Zu zahlender Betrag ans Finanzamt' : 'Erstattung vom Finanzamt', fontSize: 7, bold: true, fillColor: ustZahllast >= 0 ? '#fee2e2' : '#d1fae5', border: [true, true, true, true] },
  ]);

  // Add tax prepayments if any exist
  if (totalPrepayments > 0) {
    // Separator row
    taxTableBody.push([
      { text: '', fontSize: 2, colSpan: 3, border: [false, false, false, false] },
      {},
      {},
    ]);

    taxTableBody.push([
      { text: 'USt-Vorauszahlungen', fontSize: 8, border: [true, true, true, true] },
      { text: formatCurrency(vatPrepayments, currency), fontSize: 8, alignment: 'right', border: [true, true, true, true] },
      { text: 'Geleistete Umsatzsteuervorauszahlungen', fontSize: 7, border: [true, true, true, true] },
    ]);

    taxTableBody.push([
      { text: 'ESt-Vorauszahlungen', fontSize: 8, border: [true, true, true, true] },
      { text: formatCurrency(incomeTaxPrepayments, currency), fontSize: 8, alignment: 'right', border: [true, true, true, true] },
      { text: 'Geleistete Einkommensteuervorauszahlungen', fontSize: 7, border: [true, true, true, true] },
    ]);

    // Separator row
    taxTableBody.push([
      { text: '', fontSize: 2, colSpan: 3, border: [false, false, false, false] },
      {},
      {},
    ]);

    taxTableBody.push([
      { text: 'Verbleibende USt-Zahllast', fontSize: 8, bold: true, fillColor: ustNetPosition >= 0 ? '#fef3c7' : '#d1fae5', border: [true, true, true, true] },
      { text: formatCurrency(ustNetPosition, currency), fontSize: 8, bold: true, alignment: 'right', fillColor: ustNetPosition >= 0 ? '#fef3c7' : '#d1fae5', border: [true, true, true, true] },
      { text: ustNetPosition >= 0 ? 'Nach Abzug der Vorauszahlungen' : 'Erstattung nach Verrechnung', fontSize: 7, bold: true, fillColor: ustNetPosition >= 0 ? '#fef3c7' : '#d1fae5', border: [true, true, true, true] },
    ]);
  }

  // Build detailed tax prepayments table if there are transactions
  const prepaymentTransactions = data.tax_prepayments.transactions || [];
  let prepaymentDetailsTable: any = null;

  if (prepaymentTransactions.length > 0) {
    const prepaymentTableBody: any[] = [
      [
        { text: 'Datum', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
        { text: 'Steuerart', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
        { text: 'Quartal', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
        { text: 'Jahr', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
        { text: 'Betrag', fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
        { text: 'Beschreibung', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
      ],
    ];

    prepaymentTransactions.forEach((tx: any) => {
      const taxTypeLabel = tx.tax_type === 'vat' ? 'Umsatzsteuer' : 'Einkommensteuer';
      const quarterLabel = tx.quarter ? `Q${tx.quarter}` : '-';
      const date = new Date(tx.payment_date);
      const formattedDate = date.toLocaleDateString('de-DE', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });

      prepaymentTableBody.push([
        { text: formattedDate, fontSize: 7 },
        { text: taxTypeLabel, fontSize: 7 },
        { text: quarterLabel, fontSize: 7, alignment: 'center' },
        { text: tx.tax_year.toString(), fontSize: 7, alignment: 'center' },
        { text: formatCurrency(tx.amount, currency), fontSize: 7, alignment: 'right' },
        { text: tx.description || '-', fontSize: 7 },
      ]);
    });

    prepaymentDetailsTable = {
      text: '3.1 Detaillierte Steuervorauszahlungen',
      fontSize: 12,
      bold: true,
      margin: [0, 15, 0, 10],
    };
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [20, 90, 20, 60],
    header: (currentPage: number, pageCount: number) => createHeader('Finanzanalyse', lang, dateRange),
    footer: (currentPage: number, pageCount: number) => createFooter(currentPage, pageCount, lang),
    content: [
      // Income table
      {
        text: '1. Betriebseinnahmen',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#1e40af',
      },
      {
        table: {
          headerRows: 1,
          widths: [50, '*', 50, 50, 70, 45, 30, 45, 50],
          body: incomeTableBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },
      
      // Expenses table
      {
        text: '2. Betriebsausgaben',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#991b1b',
      },
      {
        table: {
          headerRows: 1,
          widths: [55, '*', 80, 60, 55, 35, 55, 60],
          body: expenseTableBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },

      // Tax summary table
      {
        text: '3. Steuerübersicht',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#7c3aed',
      },
      {
        table: {
          headerRows: 1,
          widths: [200, 100, '*'],
          body: taxTableBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },

      // Add detailed tax prepayments table if there are transactions
      ...(prepaymentDetailsTable ? [
        prepaymentDetailsTable,
        {
          table: {
            headerRows: 1,
            widths: [60, 80, 40, 40, 80, '*'],
            body: [
              // Header row
              [
                { text: 'Datum', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
                { text: 'Steuerart', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
                { text: 'Quartal', fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'center' },
                { text: 'Jahr', fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'center' },
                { text: 'Betrag', fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
                { text: 'Beschreibung', fontSize: 8, bold: true, fillColor: '#f3f4f6' },
              ],
              // Data rows
              ...prepaymentTransactions.map((tx: any) => {
                const taxTypeLabel = tx.tax_type === 'vat' ? 'Umsatzsteuer' : 'Einkommensteuer';
                const quarterLabel = tx.quarter ? `Q${tx.quarter}` : '-';
                const date = new Date(tx.payment_date);
                const formattedDate = date.toLocaleDateString('de-DE', { 
                  day: '2-digit', 
                  month: '2-digit', 
                  year: 'numeric' 
                });

                return [
                  { text: formattedDate, fontSize: 7 },
                  { text: taxTypeLabel, fontSize: 7 },
                  { text: quarterLabel, fontSize: 7, alignment: 'center' },
                  { text: tx.tax_year.toString(), fontSize: 7, alignment: 'center' },
                  { text: formatCurrency(tx.amount, currency), fontSize: 7, alignment: 'right' },
                  { text: tx.description || '-', fontSize: 7 },
                ];
              }),
            ],
          },
          layout: {
            hLineWidth: (i: number) => 0.5,
            vLineWidth: (i: number) => 0.5,
            hLineColor: () => '#94a3b8',
            vLineColor: () => '#94a3b8',
          },
          margin: [0, 0, 0, 25],
        },
      ] : []),

      // Summary sections
      {
        text: '4. Zusammenfassung',
        fontSize: 12,
        bold: true,
        margin: [0, 20, 0, 10],
        color: COLORS.primary,
        pageBreak: 'before',
      },
      {
        columns: [
          {
            width: '33%',
            stack: [
              { text: '1. Betriebseinnahmen', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: '#1e40af' },
              { text: `Gesamteinnahmen: ${formatCurrency(data.summary.total_income, currency)}`, fontSize: 9, margin: [0, 0, 0, 5] },
              { text: `- Rechnungen brutto: ${formatCurrency(data.income.total_invoiced, currency)}`, fontSize: 8, margin: [0, 0, 0, 3] },
              { text: `- Davon bezahlt: ${formatCurrency(data.income.total_paid, currency)}`, fontSize: 8, margin: [0, 0, 0, 3] },
              { text: `- Ausstehend: ${formatCurrency(data.income.total_outstanding, currency)}`, fontSize: 8, margin: [0, 0, 0, 10] },
            ],
          },
          {
            width: '33%',
            stack: [
              { text: '2. Betriebsausgaben', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: '#991b1b' },
              { text: `Gesamtausgaben: ${formatCurrency(data.summary.total_expenses, currency)}`, fontSize: 9, margin: [0, 0, 0, 10] },
            ],
          },
          {
            width: '34%',
            stack: [
              { text: '3. Gewinn/Verlust', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: data.summary.profit_loss >= 0 ? '#15803d' : '#991b1b' },
              { 
                text: formatCurrency(data.summary.profit_loss, currency), 
                fontSize: 14, 
                bold: true, 
                color: data.summary.profit_loss >= 0 ? '#15803d' : '#991b1b',
                margin: [0, 0, 0, 5],
              },
              { 
                text: data.summary.profit_loss >= 0 ? 'Gewinn' : 'Verlust', 
                fontSize: 8, 
                color: '#666',
              },
            ],
          },
        ],
        margin: [0, 0, 0, 20],
      },
      {
        text: '4. Umsatzsteuer-Voranmeldung (USt)', fontSize: 10, bold: true, margin: [0, 20, 0, 10], color: '#7c3aed',
      },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Ausgangsumsatzsteuer (Ust-Schuld):', fontSize: 9, margin: [0, 0, 0, 5] },
              { text: formatCurrency(ustSchuld, currency), fontSize: 12, bold: true, color: '#7c3aed' },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Vorsteuer (Bezahlte Vst):', fontSize: 9, margin: [0, 0, 0, 5] },
              { text: formatCurrency(vorsteuer, currency), fontSize: 12, bold: true, color: '#7c3aed' },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '100%',
            stack: [
              { text: 'Zahlbare Umsatzsteuer:', fontSize: 10, bold: true, margin: [0, 10, 0, 5] },
              { 
                text: formatCurrency(ustZahllast, currency), 
                fontSize: 14, 
                bold: true, 
                color: ustZahllast >= 0 ? '#7c3aed' : '#15803d',
              },
              { 
                text: ustZahllast >= 0 ? '(Zahllast)' : '(Erstattung)', 
                fontSize: 8, 
                color: '#666',
              },
            ],
          },
        ],
        margin: [0, 0, 0, totalPrepayments > 0 ? 20 : 0],
      },
      // Add tax prepayments summary if there are any prepayments
      ...(totalPrepayments > 0 ? [
        {
          text: '5. Geleistete Steuervorauszahlungen', fontSize: 10, bold: true, margin: [0, 20, 0, 10], color: '#7c3aed',
        },
        {
          columns: [
            {
              width: '33%',
              stack: [
                { text: 'USt-Vorauszahlungen:', fontSize: 9, margin: [0, 0, 0, 5] },
                { text: formatCurrency(vatPrepayments, currency), fontSize: 12, bold: true, color: '#7c3aed' },
              ],
            },
            {
              width: '33%',
              stack: [
                { text: 'ESt-Vorauszahlungen:', fontSize: 9, margin: [0, 0, 0, 5] },
                { text: formatCurrency(incomeTaxPrepayments, currency), fontSize: 12, bold: true, color: '#7c3aed' },
              ],
            },
            {
              width: '34%',
              stack: [
                { text: 'Gesamt Vorauszahlungen:', fontSize: 9, margin: [0, 0, 0, 5] },
                { text: formatCurrency(totalPrepayments, currency), fontSize: 12, bold: true, color: '#7c3aed' },
              ],
            },
          ],
          margin: [0, 0, 0, 10],
        },
        {
          columns: [
            {
              width: '100%',
              stack: [
                { text: 'Verbleibende USt-Zahllast:', fontSize: 10, bold: true, margin: [0, 10, 0, 5] },
                { 
                  text: formatCurrency(ustNetPosition, currency), 
                  fontSize: 14, 
                  bold: true, 
                  color: ustNetPosition >= 0 ? '#d97706' : '#15803d',
                },
                { 
                  text: ustNetPosition >= 0 ? '(Nach Abzug der Vorauszahlungen)' : '(Erstattung nach Verrechnung)', 
                  fontSize: 8, 
                  color: '#666',
                },
              ],
            },
          ],
        },
      ] : []),
    ],
    styles: {
      header: {
        fontSize: 20,
        bold: true,
      },
      subheader: {
        fontSize: 10,
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: COLORS.text,
      },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate Invoice Report PDF
 */
async function generateInvoiceReportPDF(
  data: InvoiceReport,
  currency: string,
  lang: Language = 'en'
): Promise<Buffer> {
  const dateRange = `${formatDate(data.period.start_date, lang)} - ${formatDate(data.period.end_date, lang)}`;

  const summaryBoxes: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: t(lang, 'total'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.total_gross, currency), fontSize: 16, bold: true, color: COLORS.primary },
          ],
          margin: [0, 0, 10, 0],
        },
        {
          width: '*',
          stack: [
            { text: t(lang, 'paidAmount'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.total_paid, currency), fontSize: 16, bold: true, color: '#10b981' },
          ],
          margin: [0, 0, 10, 0],
        },
        {
          width: '*',
          stack: [
            { text: t(lang, 'outstanding'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.total_outstanding, currency), fontSize: 16, bold: true, color: '#ef4444' },
          ],
        },
      ],
      margin: [0, 0, 0, 20],
    },
  ];

  const tableBody: TableCell[][] = [
    [
      { text: t(lang, 'invoiceNumber'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'client'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'issueDate'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'dueDate'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'status'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'amount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'paidAmount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
      { text: t(lang, 'outstanding'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  data.invoices.forEach((invoice) => {
    tableBody.push([
      { text: invoice.invoice_number, fontSize: 8 },
      { text: invoice.client_name, fontSize: 8 },
      { text: formatDate(invoice.issue_date, lang), fontSize: 8 },
      { text: formatDate(invoice.due_date, lang), fontSize: 8 },
      { text: invoice.status, fontSize: 8 },
      { text: formatCurrency(invoice.gross_amount, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(invoice.paid_amount, currency), fontSize: 8, alignment: 'right' },
      { text: formatCurrency(invoice.outstanding, currency), fontSize: 8, alignment: 'right' },
    ]);
  });

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [40, 90, 40, 60],
    header: (currentPage: number, pageCount: number) => createHeader(t(lang, 'invoiceReport'), lang, dateRange),
    footer: (currentPage: number, pageCount: number) => createFooter(currentPage, pageCount, lang),
    content: [
      ...summaryBoxes,
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: tableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
        },
      },
    ],
    styles: {
      header: {
        fontSize: 20,
        bold: true,
      },
      subheader: {
        fontSize: 10,
      },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: COLORS.text,
      },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate Expense Report PDF
 */
async function generateExpenseReportPDF(
  data: ExpenseReport,
  currency: string,
  lang: Language = 'en'
): Promise<Buffer> {
  const dateRange = `${formatDate(data.period.start_date, lang)} - ${formatDate(data.period.end_date, lang)}`;

  const summaryBoxes: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: t(lang, 'totalExpenses'), fontSize: 10, color: '#666', margin: [0, 0, 0, 5] },
            { text: formatCurrency(data.summary.total_gross, currency), fontSize: 16, bold: true, color: COLORS.primary },
          ],
        },
      ],
      margin: [0, 0, 0, 20],
    },
  ];

  const tableBody: TableCell[][] = [
    [
      { text: t(lang, 'date'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'category'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'description'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'project'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'billable'), style: 'tableHeader', fillColor: COLORS.headerBg },
      { text: t(lang, 'amount'), style: 'tableHeader', fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  data.expenses.forEach((expense) => {
    tableBody.push([
      { text: formatDate(expense.date, lang), fontSize: 8 },
      { text: expense.category || '-', fontSize: 8 },
      { text: expense.description || '-', fontSize: 8 },
      { text: expense.project_name || '-', fontSize: 8 },
      { text: expense.is_billable ? t(lang, 'yes') : t(lang, 'no'), fontSize: 8 },
      { text: formatCurrency(expense.gross_amount, currency), fontSize: 8, alignment: 'right' },
    ]);
  });

  // Total row
  tableBody.push([
    { text: t(lang, 'total'), fontSize: 9, bold: true, colSpan: 5, fillColor: COLORS.headerBg },
    {},
    {},
    {},
    {},
    { text: formatCurrency(data.summary.total_gross, currency), fontSize: 9, bold: true, alignment: 'right', fillColor: COLORS.headerBg },
  ]);

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [40, 90, 40, 60],
    header: (currentPage: number, pageCount: number) => createHeader(t(lang, 'expenseReport'), lang, dateRange),
    footer: (currentPage: number, pageCount: number) => createFooter(currentPage, pageCount, lang),
    content: [
      ...summaryBoxes,
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
          body: tableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
        },
      },
    ],
    styles: {
      header: {
        fontSize: 20,
        bold: true,
      },
      subheader: {
        fontSize: 10,
      },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: COLORS.text,
      },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate Time Tracking Report PDF
 */
async function generateTimeTrackingReportPDF(
  data: TimeTrackingReport,
  lang: 'en' | 'de' = 'de',
  currency: string = 'EUR',
  metadata?: { headline?: string; description?: string; footer?: string }
): Promise<Buffer> {
  const dateRange = `${moment(data.period.start_date).format('DD.MM.YYYY')} - ${moment(data.period.end_date).format('DD.MM.YYYY')}`;
  const reportTitle = metadata?.headline || (lang === 'de' ? 'Zeiterfassung' : 'Time Tracking');
  
  // TABLE 1: Task Summary (grouped by task_name)
  const taskSummaryMap = new Map<string, { hours: number; billable_hours: number; value: number }>();
  data.entries.forEach(entry => {
    const taskName = entry.task_name || 'Ohne Aufgabe';
    if (!taskSummaryMap.has(taskName)) {
      taskSummaryMap.set(taskName, { hours: 0, billable_hours: 0, value: 0 });
    }
    const task = taskSummaryMap.get(taskName)!;
    task.hours += entry.hours;
    if (entry.is_billable) {
      task.billable_hours += entry.hours;
      task.value += entry.value || 0;
    }
  });

  const taskSummaryBody: any[] = [
    [
      { text: 'Aufgabe', fontSize: 9, bold: true, fillColor: COLORS.headerBg },
      { text: 'Gesamtstunden', fontSize: 9, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
      { text: 'Wert', fontSize: 9, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  let taskTotalHours = 0;
  let taskTotalValue = 0;

  Array.from(taskSummaryMap.entries())
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([taskName, summary]) => {
      taskTotalHours += summary.hours;
      taskTotalValue += summary.value;
      
      taskSummaryBody.push([
        { text: taskName, fontSize: 8 },
        { text: summary.hours.toFixed(2), fontSize: 8, alignment: 'right' },
        { text: formatCurrency(summary.value, currency), fontSize: 8, alignment: 'right' },
      ]);
    });

  taskSummaryBody.push([
    { text: 'Gesamt', fontSize: 9, bold: true, fillColor: '#f3f4f6' },
    { text: taskTotalHours.toFixed(2), fontSize: 9, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
    { text: formatCurrency(taskTotalValue, currency), fontSize: 9, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
  ]);

  // TABLE 2: Daily Summary (hours per day with client and project)
  const dailySummaryMap = new Map<string, { 
    hours: number; 
    billable_hours: number; 
    value: number;
    projects: Set<string>;
    clients: Set<string>;
  }>();
  data.entries.forEach(entry => {
    const dateKey = entry.date;
    if (!dailySummaryMap.has(dateKey)) {
      dailySummaryMap.set(dateKey, { 
        hours: 0, 
        billable_hours: 0, 
        value: 0,
        projects: new Set(),
        clients: new Set()
      });
    }
    const day = dailySummaryMap.get(dateKey)!;
    day.hours += entry.hours;
    if (entry.is_billable) {
      day.billable_hours += entry.hours;
      day.value += entry.value || 0;
    }
    if (entry.project_name) day.projects.add(entry.project_name);
    if (entry.client_name) day.clients.add(entry.client_name);
  });

  const dailySummaryBody: any[] = [
    [
      { text: 'Datum', fontSize: 9, bold: true, fillColor: COLORS.headerBg },
      { text: 'Projekt(e)', fontSize: 9, bold: true, fillColor: COLORS.headerBg },
      { text: 'Kunde(n)', fontSize: 9, bold: true, fillColor: COLORS.headerBg },
      { text: 'Gesamtstunden', fontSize: 9, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
      { text: 'Wert', fontSize: 9, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  let dailyTotalHours = 0;
  let dailyTotalValue = 0;

  Array.from(dailySummaryMap.entries())
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .forEach(([dateKey, summary]) => {
      dailyTotalHours += summary.hours;
      dailyTotalValue += summary.value;
      
      const date = new Date(dateKey);
      const formattedDate = date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      const projectsList = Array.from(summary.projects).join(', ');
      const clientsList = Array.from(summary.clients).join(', ');

      dailySummaryBody.push([
        { text: formattedDate, fontSize: 8 },
        { text: projectsList || '-', fontSize: 7 },
        { text: clientsList || '-', fontSize: 7 },
        { text: summary.hours.toFixed(2), fontSize: 8, alignment: 'right' },
        { text: formatCurrency(summary.value, currency), fontSize: 8, alignment: 'right' },
      ]);
    });

  dailySummaryBody.push([
    { text: 'Gesamt', fontSize: 9, bold: true, fillColor: '#f3f4f6', colSpan: 3 },
    {},
    {},
    { text: dailyTotalHours.toFixed(2), fontSize: 9, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
    { text: formatCurrency(dailyTotalValue, currency), fontSize: 9, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
  ]);

  // TABLE 3: Detailed Entries
  const entriesTableBody: any[] = [
    [
      { text: 'Datum', fontSize: 8, bold: true, fillColor: COLORS.headerBg },
      { text: 'Projekt', fontSize: 8, bold: true, fillColor: COLORS.headerBg },
      { text: 'Kunde', fontSize: 8, bold: true, fillColor: COLORS.headerBg },
      { text: 'Aufgabe', fontSize: 8, bold: true, fillColor: COLORS.headerBg },
      { text: 'Beschreibung', fontSize: 8, bold: true, fillColor: COLORS.headerBg },
      { text: 'Stunden', fontSize: 8, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
      { text: 'Stundensatz', fontSize: 8, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
      { text: 'Wert', fontSize: 8, bold: true, fillColor: COLORS.headerBg, alignment: 'right' },
    ],
  ];

  data.entries.forEach(entry => {
    const date = new Date(entry.date);
    const formattedDate = date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    entriesTableBody.push([
      { text: formattedDate, fontSize: 7 },
      { text: entry.project_name || '-', fontSize: 7 },
      { text: entry.client_name || '-', fontSize: 7 },
      { text: entry.task_name || '-', fontSize: 7 },
      { text: entry.description || '-', fontSize: 7 },
      { text: entry.hours.toFixed(2), fontSize: 7, alignment: 'right' },
      { text: entry.hourly_rate ? formatCurrency(entry.hourly_rate, currency) : '-', fontSize: 7, alignment: 'right' },
      { text: entry.value ? formatCurrency(entry.value, currency) : '-', fontSize: 7, alignment: 'right' },
    ]);
  });

  entriesTableBody.push([
    { text: 'Gesamt', fontSize: 8, bold: true, fillColor: '#f3f4f6', colSpan: 5 },
    {},
    {},
    {},
    {},
    { text: data.summary.total_hours.toFixed(2), fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
    { text: '', fontSize: 8, fillColor: '#f3f4f6' },
    { text: formatCurrency(data.summary.billable_value, currency), fontSize: 8, bold: true, fillColor: '#f3f4f6', alignment: 'right' },
  ]);

  // Simple sequential page numbering
  const customFooter = (currentPage: number, pageCount: number): Content => {
    // Summary page (last page) - no footer
    if (currentPage === pageCount) {
      return { text: '', margin: [0, 0, 0, 0] } as Content;
    }
    
    return {
      columns: [
        {
          text: `Seite ${currentPage} von ${pageCount - 1}`,
          alignment: 'center',
          fontSize: 8,
          color: '#64748b',
          margin: [0, 20, 0, 0],
        },
      ],
    } as Content;
  };

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [20, 90, 20, 60],
    header: (currentPage: number, pageCount: number) => createHeader(reportTitle, lang, dateRange),
    footer: customFooter,
    info: {
      title: reportTitle,
      subject: metadata?.description || '',
    },
    content: [
      // TABLE 1: Task Summary
      {
        text: '1. Zusammenfassung nach Aufgabe',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#1e40af',
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 100, 120],
          body: taskSummaryBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },

      // TABLE 2: Daily Summary
      {
        text: '2. Zusammenfassung nach Tag',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#1e40af',
        pageBreak: 'before',
      },
      {
        table: {
          headerRows: 1,
          widths: [60, 150, 150, 80, 100],
          body: dailySummaryBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },

      // TABLE 3: Detailed Entries
      {
        text: '3. Detaillierte Zeiteinträge',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
        color: '#1e40af',
        pageBreak: 'before',
      },
      {
        table: {
          headerRows: 1,
          widths: [55, 80, 80, 60, '*', 50, 70, 70],
          body: entriesTableBody,
        },
        layout: {
          hLineWidth: (i: number) => 0.5,
          vLineWidth: (i: number) => 0.5,
          hLineColor: () => '#94a3b8',
          vLineColor: () => '#94a3b8',
        },
        margin: [0, 0, 0, 25],
      },

      // SUMMARY PAGE (not counted in pagination)
      {
        text: 'Gesamtzusammenfassung',
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 20],
        color: COLORS.primary,
        pageBreak: 'before',
      },
      {
        columns: [
          {
            width: '33%',
            stack: [
              { text: 'Gesamtstunden', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: '#1e40af' },
              { text: `${data.summary.total_hours.toFixed(2)} Stunden`, fontSize: 14, bold: true, color: '#1e40af', margin: [0, 0, 0, 5] },
            ],
          },
          {
            width: '33%',
            stack: [
              { text: 'Abrechenbare Stunden', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: '#15803d' },
              { text: `${data.summary.billable_hours.toFixed(2)} Stunden`, fontSize: 14, bold: true, color: '#15803d', margin: [0, 0, 0, 5] },
            ],
          },
          {
            width: '34%',
            stack: [
              { text: 'Nicht abrechenbar', fontSize: 10, bold: true, margin: [0, 0, 0, 10], color: '#991b1b' },
              { text: `${data.summary.non_billable_hours.toFixed(2)} Stunden`, fontSize: 14, bold: true, color: '#991b1b', margin: [0, 0, 0, 5] },
            ],
          },
        ],
        margin: [0, 0, 0, 20],
      },
      {
        columns: [
          {
            width: '100%',
            stack: [
              { text: 'Abrechnungswert:', fontSize: 10, bold: true, margin: [0, 10, 0, 5] },
              { text: formatCurrency(data.summary.billable_value, currency), fontSize: 16, bold: true, color: '#15803d' },
            ],
          },
        ],
      },
    ],
    styles: {
      header: {
        fontSize: 20,
        bold: true,
      },
      subheader: {
        fontSize: 10,
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: COLORS.text,
      },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export default {
  generateVATReportPDF,
  generateIncomeExpenseReportPDF,
  generateInvoiceReportPDF,
  generateExpenseReportPDF,
  generateTimeTrackingReportPDF,
};
