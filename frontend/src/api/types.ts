export type ClientStatus = 'active' | 'inactive';

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
}

export interface ClientPayload {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ClientStatus;
  billing_contact_person?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_postal_code?: string | null;
  billing_country?: string | null;
  billing_tax_id?: string | null;
}

export type ProjectStatus = 'not_started' | 'active' | 'on_hold' | 'completed';
export type RateType = 'hourly' | 'fixed_fee';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  client_id: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  currency: string | null;
  rate_type: RateType | null;
  hourly_rate: number | null;
  estimated_hours: number | null;
  recurring_payment?: boolean;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
  total_tracked_hours?: number | null;
}

export interface ProjectPayload {
  name: string;
  description?: string | null;
  client_id: string;
  status?: ProjectStatus;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
  currency?: string | null;
  rate_type?: RateType | null;
  hourly_rate?: number | null;
  estimated_hours?: number | null;
  recurring_payment?: boolean;
}

export interface TimeEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  description: string | null;
  task_name: string | null;
  category: string | null;
  entry_date: string; // Single date (YYYY-MM-DD)
  entry_time: string; // Start time (HH:MM:SS or HH:MM)
  entry_end_time?: string | null; // End time (HH:MM:SS or HH:MM), optional
  duration_hours: number; // Duration in hours (decimal, e.g., 2.5)
  billable: boolean;
  hourly_rate: number | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  client_name?: string | null;
  date_start?: string | null; // Active timer indicator - when set, entry is still running
  // Legacy fields for backward compatibility
  start_time?: string;
  end_time?: string | null;
  duration_minutes?: number | null;
}

export interface TimeEntryPayload {
  project_id: string;
  description?: string | null;
  task_name?: string | null;
  category?: string | null;
  entry_date: string; // Single date (YYYY-MM-DD)
  entry_time: string; // Start time (HH:MM or HH:MM:SS)
  entry_end_time?: string | null; // End time (HH:MM or HH:MM:SS), optional
  duration_hours: number; // Duration in hours (required)
  billable?: boolean;
  hourly_rate?: number | null;
}

export interface TimeEntryListParams {
  user_id?: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface TimeEntryResponse {
  message: string;
  time_entry: TimeEntry;
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id: string;
  user_id: string;
  client_id: string;
  project_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  sub_total: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  notes: string | null;
  tax_rate_id: string | null;
  invoice_text: string | null;
  invoice_headline?: string | null;
  header_template_id?: string | null;
  footer_template_id?: string | null;
  terms_template_id?: string | null;
  footer_text: string | null;
  tax_exemption_text: string | null;
  enable_zugferd?: boolean;
  delivery_date?: string | null;
  exclude_from_tax?: boolean;
  // Correction fields
  original_data?: Record<string, unknown> | null;
  correction_reason?: string | null;
  correction_date?: string | null;
  correction_of_invoice_id?: string | null;
  created_at: string;
  updated_at: string;
  client_name?: string;
  project_name?: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  rate_type?: 'hourly' | 'daily';
  created_at: string;
  time_entry_id?: string | null;
}

export interface InvoiceWithItems extends Invoice {
  items?: InvoiceItem[];
  payments?: Payment[];
}

// Billing validation types
export type BillingStatus = 'valid' | 'underbilled' | 'overbilled';

export interface BillingValidationResult {
  invoice_id: string;
  invoice_total: number;
  total_paid: number;
  balance: number;
  status: BillingStatus;
  warnings: string[];
  threshold: number;
  currency: string;
}

export interface PaymentValidationResult {
  isValid: boolean;
  warnings: string[];
  projectedBalance: number;
  projectedStatus: BillingStatus;
}

export interface PaymentRecordResponse {
  message: string;
  payment: Payment;
  billing_status?: {
    status: BillingStatus;
    balance: number;
    warnings: string[];
  };
  alert?: {
    level: 'info' | 'warning' | 'error';
    message: string;
  };
}

export interface InvoiceResponse {
  message: string;
  invoice: InvoiceWithItems;
}

export interface InvoicePayload {
  client_id: string;
  project_id?: string | null;
  invoice_number?: string;
  status?: InvoiceStatus;
  issue_date: string;
  due_date: string;
  delivery_date?: string | null;
  sub_total?: number;
  notes?: string | null;
  currency?: string;
  tax_rate_id?: string | null;
  invoice_text?: string | null;
  invoice_headline?: string | null;
  header_template_id?: string | null;
  footer_template_id?: string | null;
  terms_template_id?: string | null;
  footer_text?: string | null;
  tax_exemption_text?: string | null;
  enable_zugferd?: boolean;
  exclude_from_tax?: boolean;
}

export interface InvoiceLineItemPayload {
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  time_entry_id?: string | null;
  rate_type?: 'hourly' | 'daily';
}

export interface GenerateInvoiceFromTimeEntriesPayload {
  project_id?: string;
  client_id?: string;
  start_date?: string;
  end_date?: string;
  invoice_headline?: string;
  header_template_id?: string;
  footer_template_id?: string;
  terms_template_id?: string;
}

export interface BillingHistoryEntry {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total_amount: number;
  status: InvoiceStatus;
  currency: string;
  amount_paid: number;
  outstanding_balance: number;
}

export interface DashboardMetrics {
  activeProjects: number;
  activeClients: number;
  hoursThisWeek: number;
  outstandingInvoiceCount: number;
  outstandingInvoiceTotal: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  thisMonthLabel: string;
  lastMonthLabel: string;
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  weeklyHours: TimeSeriesPoint[];
  revenueTrend: TimeSeriesPoint[];
  recentTimeEntries: TimeEntry[];
  recentInvoices: Invoice[];
}

export type PaymentType = 'payment' | 'refund' | 'expense';

export interface Payment {
  id: string;
  user_id: string;
  client_id: string | null;
  client_name?: string | null; // Joined from clients table
  invoice_id: string | null;
  project_id?: string | null;
  amount: number;
  payment_type: PaymentType;
  payment_method: string | null;
  transaction_id: string | null;
  payment_date: string;
  notes: string | null;
  exclude_from_tax?: boolean;
  created_at: string;
}

export interface PaymentPayload {
  client_id?: string | null;
  invoice_id?: string | null;
  project_id?: string | null;
  amount: number;
  payment_type?: PaymentType;
  payment_method?: string | null;
  transaction_id?: string | null;
  payment_date?: string | null;
  notes?: string | null;
  exclude_from_tax?: boolean;
}

export interface PaymentResponse {
  message: string;
  payment: Payment;
}

export interface ApiListParams {
  search?: string;
  status?: string;
  clientId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
}

// Tax Rates
export interface TaxRate {
  id: string;
  user_id: string;
  name: string;
  rate: number;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  country_code: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaxRatePayload {
  name: string;
  rate: number;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  country_code?: string | null;
  sort_order?: number;
}

// Invoice Text Templates
export type TemplateCategory = 
  | 'tax_exemption' 
  | 'payment_terms' 
  | 'legal_notice' 
  | 'footer' 
  | 'header' 
  | 'custom';

export interface InvoiceTextTemplate {
  id: string;
  user_id: string;
  name: string;
  category: TemplateCategory;
  content: string;
  language: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceTextTemplatePayload {
  name: string;
  category: TemplateCategory;
  content: string;
  language?: string;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

// Client with billing address
export interface ClientWithBilling extends Client {
  use_separate_billing_address: boolean;
  billing_contact_person: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
}

export interface ClientPayloadWithBilling extends ClientPayload {
  use_separate_billing_address?: boolean;
  billing_contact_person?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_postal_code?: string | null;
  billing_country?: string | null;
}

// Expenses
export type ExpenseCategory = 
  // IT & Digital Equipment (1 year depreciation since 2021)
  | 'computer'           // Computer, Laptop, Tablet, Workstation, Server
  | 'software'           // Operating and application software
  | 'peripherals'        // Keyboard, Mouse, Headset, Webcam, Docking Station
  | 'storage'            // External HDD, USB drives, DVD drives
  | 'display'            // Monitors, Displays, Projectors
  | 'printer'            // Laser/Inkjet printers, Scanners
  
  // Office Equipment
  | 'office_furniture'   // Desks, Chairs (13 years)
  | 'office_equipment'   // Phones (5y), Copiers (7y)
  | 'office_supplies'    // Consumables, stationery
  
  // Vehicles
  | 'vehicle_car'        // Cars, passenger vehicles (6 years)
  | 'vehicle_motorcycle' // Motorcycles, E-bikes (7 years)
  
  // Professional Tools & Equipment
  | 'camera'             // Photography equipment (7 years)
  | 'tools'              // Hand tools, equipment (5 years)
  | 'machinery'          // Larger machinery (varies)
  
  // Services & Operating Expenses
  | 'insurance'          // Business insurance (Berufshaftpflicht, etc.)
  | 'professional_services' // Accountant, lawyer, consultants
  | 'marketing'          // Marketing, advertising
  | 'utilities'          // Electricity, water, heating
  | 'travel'             // Business travel
  | 'meals'              // Business meals (often 70% deductible)
  | 'training'           // Professional development, courses
  | 'rent'               // Office/business space rent
  | 'telecommunications' // Phone, internet
  
  // Other
  | 'other';

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'reimbursed';

export type RecurrenceFrequency = 'monthly' | 'quarterly' | 'yearly';

export interface Expense {
  id: string;
  user_id: string;
  project_id: string | null;
  category: ExpenseCategory | string;
  description: string;
  amount: number;
  net_amount: number;
  tax_rate: number;
  tax_amount: number;
  currency: string;
  expense_date: string;
  receipt_url: string | null;
  receipt_filename: string | null;
  receipt_size: number | null;
  receipt_mimetype: string | null;
  is_billable: boolean;
  is_reimbursable: boolean;
  status: ExpenseStatus;
  tags: string[];
  notes: string | null;
  is_recurring: boolean;
  recurrence_frequency: RecurrenceFrequency | string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  parent_expense_id: string | null;
  next_occurrence: string | null;
  // Depreciation (AfA) fields
  depreciation_type?: 'none' | 'immediate' | 'partial';
  depreciation_years?: number | null;
  depreciation_start_date?: string | null;
  depreciation_method?: 'linear' | 'degressive';
  useful_life_category?: string | null;
  tax_deductible_amount?: number | null;
  tax_deductible_percentage?: number; // 0-100, default 100
  tax_deductibility_reasoning?: string | null;
  tax_deductibility_analysis_date?: string | null;
  has_ai_analysis?: boolean;
  ai_analysis_result?: any;
  ai_analysis_response?: any; // Saved AI analysis response (includes confidence, sources, reasoning, etc.)
  ai_analysis_date?: string | null;
  created_at: string;
  updated_at: string;
  // Optional joined fields
  project_name?: string;
  client_name?: string;
}

export interface CreateExpenseData {
  project_id?: string | null;
  category: ExpenseCategory | string;
  description: string;
  amount: number;
  net_amount: number;
  tax_rate: number;
  tax_amount: number;
  currency: string;
  expense_date: string;
  is_billable?: boolean;
  is_reimbursable?: boolean;
  tags?: string[];
  notes?: string | null;
  is_recurring?: boolean;
  recurrence_frequency?: RecurrenceFrequency | string | null;
  recurrence_start_date?: string | null;
  recurrence_end_date?: string | null;
}

export interface UpdateExpenseData {
  project_id?: string | null;
  category?: ExpenseCategory | string;
  description?: string;
  amount?: number;
  net_amount?: number;
  tax_rate?: number;
  tax_amount?: number;
  currency?: string;
  expense_date?: string;
  is_billable?: boolean;
  is_reimbursable?: boolean;
  status?: ExpenseStatus;
  tags?: string[];
  notes?: string | null;
  is_recurring?: boolean;
  recurrence_frequency?: RecurrenceFrequency | string | null;
  recurrence_start_date?: string | null;
  recurrence_end_date?: string | null;
  // Depreciation (AfA) fields
  depreciation_type?: 'none' | 'immediate' | 'partial';
  depreciation_years?: number | null;
  depreciation_start_date?: string | null;
  depreciation_method?: 'linear' | 'degressive';
  useful_life_category?: string | null;
  tax_deductible_amount?: number | null;
}

export interface ExpenseFilters {
  user_id?: string;
  project_id?: string;
  category?: ExpenseCategory | string;
  status?: ExpenseStatus;
  is_billable?: boolean;
  is_reimbursable?: boolean;
  date_from?: string;
  date_to?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ExpenseSummary {
  total_expenses: number;
  total_amount: number;
  net_amount: number;
  tax_amount: number;
  billable_amount: number;
  non_billable_amount: number;
  pending_amount: number;
  approved_amount: number;
  approved_net_amount: number;
  approved_tax_amount: number;
  by_category: {
    category: string;
    count: number;
    total_amount: number;
  }[];
}

/**
 * User settings and company information
 */
export interface Settings {
  id: string;
  user_id: string;
  user_region: string | null;
  company_name: string | null;
  company_address: string | null;
  company_city: string | null;
  company_state: string | null;
  company_postal_code: string | null;
  company_country: string | null;
  company_tax_id: string | null;
  company_email: string | null;
  company_phone: string | null;
  company_website: string | null;
  company_logo_url: string | null;
  company_subline: string | null;
  invoice_prefix: string;
  invoice_number_start: number;
  invoice_number_current: number;
  default_tax_rate: number;
  default_currency: string;
  default_payment_terms: number;
  bank_name: string | null;
  bank_iban: string | null;
  bank_bic: string | null;
  bank_account_holder: string | null;
  ai_enabled: boolean;
  ai_provider: string;
  ai_api_url: string | null;
  ai_api_key: string | null;
  ai_model: string | null;
  mcp_server_url: string | null;
  mcp_server_api_key: string | null;
  created_at: string;
  updated_at: string;
}
