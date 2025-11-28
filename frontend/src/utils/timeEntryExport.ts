/**
 * @fileoverview Time Entry Report Export Service
 * 
 * Generates comprehensive PDF and Excel reports for time entries with:
 * - Task summary (grouped by task name)
 * - Daily hours summary
 * - Detailed time entries
 * - Multi-page PDF with proper pagination
 * - Professional Excel formatting
 * 
 * @module utils/timeEntryExport
 */

import ExcelJS from 'exceljs';
import pdfMake from 'pdfmake/build/pdfmake';
import { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { TimeEntry } from '../api/types';

// Ensure pdfMake fonts are loaded
import pdfFonts from 'pdfmake/build/vfs_fonts';
if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
} else if (pdfFonts) {
  (pdfMake as any).vfs = pdfFonts;
}

export interface TimeEntryExportFilters {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  projectName?: string;
  clientId?: string;
  clientName?: string;
}

export interface TaskSummary {
  taskName: string;
  projectName: string;
  clientName: string | null;
  totalHours: number;
  entryCount: number;
}

export interface DailySummary {
  date: string;
  totalHours: number;
  entryCount: number;
}

/**
 * Group time entries by task and calculate summaries
 */
function generateTaskSummary(entries: TimeEntry[]): TaskSummary[] {
  const taskMap = new Map<string, TaskSummary>();
  
  entries.forEach(entry => {
    const key = `${entry.task_name || 'Untitled'}_${entry.project_name}_${entry.client_name || 'No Client'}`;
    
    if (taskMap.has(key)) {
      const existing = taskMap.get(key)!;
      existing.totalHours += entry.duration_hours || 0;
      existing.entryCount += 1;
    } else {
      taskMap.set(key, {
        taskName: entry.task_name || 'Untitled Task',
        projectName: entry.project_name || 'Unknown Project',
        clientName: entry.client_name || null,
        totalHours: entry.duration_hours || 0,
        entryCount: 1,
      });
    }
  });
  
  return Array.from(taskMap.values()).sort((a, b) => b.totalHours - a.totalHours);
}

/**
 * Group time entries by date and calculate daily summaries
 */
function generateDailySummary(entries: TimeEntry[]): DailySummary[] {
  const dailyMap = new Map<string, DailySummary>();
  
  entries.forEach(entry => {
    const date = entry.entry_date ? new Date(entry.entry_date).toLocaleDateString('de-DE') : 'Unknown';
    
    if (dailyMap.has(date)) {
      const existing = dailyMap.get(date)!;
      existing.totalHours += entry.duration_hours || 0;
      existing.entryCount += 1;
    } else {
      dailyMap.set(date, {
        date,
        totalHours: entry.duration_hours || 0,
        entryCount: 1,
      });
    }
  });
  
  return Array.from(dailyMap.values()).sort((a, b) => {
    const dateA = new Date(a.date.split('.').reverse().join('-'));
    const dateB = new Date(b.date.split('.').reverse().join('-'));
    return dateA.getTime() - dateB.getTime();
  });
}

/**
 * Format hours for display (e.g., 8.5 → "8.50 h")
 */
function formatHours(hours: number): string {
  return `${hours.toFixed(2)} h`;
}

/**
 * Format date for display
 */
function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('de-DE');
}

/**
 * Format time for display
 */
function formatTime(timeString: string | null | undefined): string {
  if (!timeString) return '-';
  return timeString.substring(0, 5); // HH:MM
}

/**
 * Export time entries as CSV
 */
export function exportTimeEntriesAsCSV(
  entries: TimeEntry[],
  filters: TimeEntryExportFilters,
  filename: string
): void {
  const taskSummary = generateTaskSummary(entries);
  const dailySummary = generateDailySummary(entries);
  
  let csv = '\uFEFF'; // UTF-8 BOM for Excel compatibility
  
  // Header
  csv += `"Zeiterfassung Report"\n`;
  csv += `"Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}"\n`;
  if (filters.projectName) csv += `"Projekt: ${filters.projectName}"\n`;
  if (filters.clientName) csv += `"Kunde: ${filters.clientName}"\n`;
  csv += `"Generiert: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}"\n`;
  csv += '\n';
  
  // Task Summary
  csv += '"AUFGABEN-ZUSAMMENFASSUNG"\n';
  csv += '"Aufgabe","Projekt","Kunde","Stunden","Einträge"\n';
  taskSummary.forEach(task => {
    csv += `"${task.taskName}","${task.projectName}","${task.clientName || '-'}","${task.totalHours.toFixed(2)}","${task.entryCount}"\n`;
  });
  csv += '\n';
  
  // Daily Summary
  csv += '"TÄGLICHE ZUSAMMENFASSUNG"\n';
  csv += '"Datum","Stunden","Einträge"\n';
  dailySummary.forEach(day => {
    csv += `"${day.date}","${day.totalHours.toFixed(2)}","${day.entryCount}"\n`;
  });
  csv += '\n';
  
  // Detailed Entries
  csv += '"DETAILLIERTE ZEITEINTRÄGE"\n';
  csv += '"Datum","Startzeit","Endzeit","Dauer","Aufgabe","Projekt","Kunde","Beschreibung","Abrechenbar"\n';
  entries.forEach(entry => {
    csv += `"${formatDate(entry.entry_date)}","${formatTime(entry.entry_time)}","${formatTime(entry.entry_end_time)}","${entry.duration_hours?.toFixed(2) || '0.00'}","${entry.task_name || '-'}","${entry.project_name || '-'}","${entry.client_name || '-'}","${entry.description || '-'}","${entry.billable ? 'Ja' : 'Nein'}"\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export time entries as Excel with multiple sheets and formatting
 */
export async function exportTimeEntriesAsExcel(
  entries: TimeEntry[],
  filters: TimeEntryExportFilters,
  filename: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const taskSummary = generateTaskSummary(entries);
  const dailySummary = generateDailySummary(entries);
  
  // Metadata
  workbook.creator = 'tyme - Time Tracking System';
  workbook.created = new Date();
  workbook.modified = new Date();
  
  // --- SHEET 1: Task Summary ---
  const taskSheet = workbook.addWorksheet('Aufgaben-Zusammenfassung');
  
  // Header
  taskSheet.getCell('A1').value = 'Zeiterfassung Report - Aufgaben-Zusammenfassung';
  taskSheet.getCell('A1').font = { bold: true, size: 14 };
  taskSheet.getCell('A2').value = `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`;
  if (filters.projectName) {
    taskSheet.getCell('A3').value = `Projekt: ${filters.projectName}`;
  }
  if (filters.clientName) {
    taskSheet.getCell('A4').value = `Kunde: ${filters.clientName}`;
  }
  
  const headerRow = taskSheet.getRow(6);
  headerRow.values = ['Aufgabe', 'Projekt', 'Kunde', 'Stunden', 'Einträge'];
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  taskSummary.forEach((task, index) => {
    const row = taskSheet.getRow(7 + index);
    row.values = [
      task.taskName,
      task.projectName,
      task.clientName || '-',
      task.totalHours,
      task.entryCount,
    ];
    row.getCell(4).numFmt = '0.00';
  });
  
  taskSheet.columns = [
    { width: 30 },
    { width: 25 },
    { width: 25 },
    { width: 12 },
    { width: 12 },
  ];
  
  // --- SHEET 2: Daily Summary ---
  const dailySheet = workbook.addWorksheet('Tägliche Zusammenfassung');
  
  dailySheet.getCell('A1').value = 'Zeiterfassung Report - Tägliche Zusammenfassung';
  dailySheet.getCell('A1').font = { bold: true, size: 14 };
  dailySheet.getCell('A2').value = `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`;
  
  const dailyHeaderRow = dailySheet.getRow(4);
  dailyHeaderRow.values = ['Datum', 'Stunden', 'Einträge'];
  dailyHeaderRow.font = { bold: true };
  dailyHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' },
  };
  dailyHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  dailySummary.forEach((day, index) => {
    const row = dailySheet.getRow(5 + index);
    row.values = [day.date, day.totalHours, day.entryCount];
    row.getCell(2).numFmt = '0.00';
  });
  
  dailySheet.columns = [
    { width: 15 },
    { width: 12 },
    { width: 12 },
  ];
  
  // --- SHEET 3: Detailed Entries ---
  const detailSheet = workbook.addWorksheet('Detaillierte Zeiteinträge');
  
  detailSheet.getCell('A1').value = 'Zeiterfassung Report - Detaillierte Einträge';
  detailSheet.getCell('A1').font = { bold: true, size: 14 };
  detailSheet.getCell('A2').value = `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`;
  
  const detailHeaderRow = detailSheet.getRow(4);
  detailHeaderRow.values = [
    'Datum',
    'Startzeit',
    'Endzeit',
    'Dauer (h)',
    'Aufgabe',
    'Projekt',
    'Kunde',
    'Beschreibung',
    'Abrechenbar',
  ];
  detailHeaderRow.font = { bold: true };
  detailHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' },
  };
  detailHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  entries.forEach((entry, index) => {
    const row = detailSheet.getRow(5 + index);
    row.values = [
      formatDate(entry.entry_date),
      formatTime(entry.entry_time),
      formatTime(entry.entry_end_time),
      entry.duration_hours || 0,
      entry.task_name || '-',
      entry.project_name || '-',
      entry.client_name || '-',
      entry.description || '-',
      entry.billable ? 'Ja' : 'Nein',
    ];
    row.getCell(4).numFmt = '0.00';
  });
  
  detailSheet.columns = [
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 25 },
    { width: 20 },
    { width: 20 },
    { width: 35 },
    { width: 12 },
  ];
  
  // Save and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export time entries as PDF with multiple tables on separate pages
 */
export async function exportTimeEntriesAsPDF(
  entries: TimeEntry[],
  filters: TimeEntryExportFilters,
  filename: string
): Promise<void> {
  const taskSummary = generateTaskSummary(entries);
  const dailySummary = generateDailySummary(entries);
  
  const totalHours = entries.reduce((sum, entry) => sum + (entry.duration_hours || 0), 0);
  const totalEntries = entries.length;
  
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    
    // Header with correct page numbering
    header: function(currentPage, pageCount) {
      // Last page is summary page - no header
      if (currentPage === pageCount) return null;
      
      return {
        margin: [40, 20, 40, 0],
        columns: [
          {
            text: 'Zeiterfassung Report',
            style: 'header',
          },
          {
            text: `Seite ${currentPage} von ${pageCount - 1}`,
            style: 'pageNumber',
            alignment: 'right',
          },
        ],
      };
    },
    
    // Footer with section names
    footer: function(currentPage, pageCount) {
      // Last page is summary page - no footer
      if (currentPage === pageCount) return null;
      
      // We use ID markers in content to track sections, but since pdfMake
      // doesn't easily give us section info, we'll show a simple footer
      return {
        margin: [40, 0, 40, 20],
        columns: [
          {
            text: `Seite ${currentPage} von ${pageCount - 1}`,
            style: 'footerSection',
            alignment: 'left',
          },
          {
            text: `Generiert: ${new Date().toLocaleDateString('de-DE')}`,
            style: 'footerDate',
            alignment: 'right',
          },
        ],
      };
    },
    
    content: [] as Content[],
    
    styles: {
      header: {
        fontSize: 14,
        bold: true,
        color: '#4F46E5',
      },
      pageNumber: {
        fontSize: 10,
        color: '#6B7280',
      },
      sectionTitle: {
        fontSize: 16,
        bold: true,
        margin: [0, 0, 0, 15] as [number, number, number, number],
      },
      filterText: {
        fontSize: 10,
        color: '#6B7280',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      },
      tableHeader: {
        bold: true,
        fontSize: 10,
        color: '#FFFFFF',
        fillColor: '#4F46E5',
      },
      footerSection: {
        fontSize: 9,
        color: '#6B7280',
      },
      footerDate: {
        fontSize: 9,
        color: '#6B7280',
      },
      summaryTitle: {
        fontSize: 18,
        bold: true,
        alignment: 'center',
        margin: [0, 100, 0, 30] as [number, number, number, number],
      },
      summaryText: {
        fontSize: 14,
        alignment: 'center',
        margin: [0, 10, 0, 10] as [number, number, number, number],
      },
    },
  };
  
  // --- PAGE 1: Task Summary ---
  const taskContent: Content[] = [
    { text: 'Aufgaben-Zusammenfassung', style: 'sectionTitle' },
    { text: `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`, style: 'filterText' },
  ];
  
  if (filters.projectName) {
    taskContent.push({ text: `Projekt: ${filters.projectName}`, style: 'filterText' });
  }
  if (filters.clientName) {
    taskContent.push({ text: `Kunde: ${filters.clientName}`, style: 'filterText' });
  }
  
  taskContent.push({ text: '\n' });
  
  taskContent.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [
          { text: 'Aufgabe', style: 'tableHeader' },
          { text: 'Projekt', style: 'tableHeader' },
          { text: 'Kunde', style: 'tableHeader' },
          { text: 'Stunden', style: 'tableHeader' },
          { text: 'Einträge', style: 'tableHeader' },
        ],
        ...taskSummary.map(task => [
          task.taskName,
          task.projectName,
          task.clientName || '-',
          formatHours(task.totalHours),
          task.entryCount.toString(),
        ]),
      ],
    },
    layout: {
      fillColor: function (rowIndex: number) {
        return rowIndex === 0 ? '#4F46E5' : (rowIndex % 2 === 0 ? '#F3F4F6' : null);
      },
    },
  });
  
  taskContent.push({ text: '', pageBreak: 'after' as any });
  
  docDefinition.content.push(...taskContent);
  
  // --- PAGE 2: Daily Summary ---
  const dailyContent: Content[] = [
    { text: 'Tägliche Zusammenfassung', style: 'sectionTitle' },
    { text: `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`, style: 'filterText' },
    { text: '\n' },
  ];
  
  dailyContent.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto'],
      body: [
        [
          { text: 'Datum', style: 'tableHeader' },
          { text: 'Stunden', style: 'tableHeader' },
          { text: 'Einträge', style: 'tableHeader' },
        ],
        ...dailySummary.map(day => [
          day.date,
          formatHours(day.totalHours),
          day.entryCount.toString(),
        ]),
      ],
    },
    layout: {
      fillColor: function (rowIndex: number) {
        return rowIndex === 0 ? '#4F46E5' : (rowIndex % 2 === 0 ? '#F3F4F6' : null);
      },
    },
  });
  
  dailyContent.push({ text: '', pageBreak: 'after' as any });
  
  docDefinition.content.push(...dailyContent);
  
  // --- PAGE 3: Detailed Entries ---
  const detailContent: Content[] = [
    { text: 'Detaillierte Zeiteinträge', style: 'sectionTitle' },
    { text: `Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`, style: 'filterText' },
    { text: '\n' },
  ];
  
  detailContent.push({
    table: {
      headerRows: 1,
      widths: [50, 45, 45, 40, '*', 70, 70],
      body: [
        [
          { text: 'Datum', style: 'tableHeader' },
          { text: 'Start', style: 'tableHeader' },
          { text: 'Ende', style: 'tableHeader' },
          { text: 'Dauer', style: 'tableHeader' },
          { text: 'Aufgabe', style: 'tableHeader' },
          { text: 'Projekt', style: 'tableHeader' },
          { text: 'Kunde', style: 'tableHeader' },
        ],
        ...entries.map(entry => [
          formatDate(entry.entry_date),
          formatTime(entry.entry_time),
          formatTime(entry.entry_end_time),
          formatHours(entry.duration_hours || 0),
          entry.task_name || '-',
          entry.project_name || '-',
          entry.client_name || '-',
        ]),
      ],
    },
    layout: {
      fillColor: function (rowIndex: number) {
        return rowIndex === 0 ? '#4F46E5' : (rowIndex % 2 === 0 ? '#F3F4F6' : null);
      },
    },
  });
  
  detailContent.push({ text: '', pageBreak: 'after' as any });
  
  docDefinition.content.push(...detailContent);
  
  // --- FINAL PAGE: Summary (not counted in page numbers) ---
  const summaryContent: Content[] = [
    { text: 'Zusammenfassung', style: 'summaryTitle' },
    { text: '\n\n' },
    { text: `Gesamt-Zeitraum: ${filters.startDate ? formatDate(filters.startDate) : 'Alle'} - ${filters.endDate ? formatDate(filters.endDate) : 'Alle'}`, style: 'summaryText' },
    { text: `Gesamtstunden: ${formatHours(totalHours)}`, style: 'summaryText', bold: true, fontSize: 16 },
    { text: `Anzahl Einträge: ${totalEntries}`, style: 'summaryText' },
    { text: `Anzahl Aufgaben: ${taskSummary.length}`, style: 'summaryText' },
    { text: `Anzahl Arbeitstage: ${dailySummary.length}`, style: 'summaryText' },
    { text: '\n\n' },
    { text: `Generiert am: ${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE')}`, style: 'filterText', alignment: 'center' },
  ];
  
  docDefinition.content.push(...summaryContent);
  
  // Generate and download PDF
  pdfMake.createPdf(docDefinition).download(filename);
}
