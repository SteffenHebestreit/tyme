--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: calculate_deductible_amount(numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_deductible_amount(p_net_amount numeric, p_tax_deductible_percentage numeric, p_tax_deductible_amount numeric) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  -- If there's a depreciation schedule amount, use that as the base
  -- Otherwise, use the full net amount
  -- Then apply the deductibility percentage
  
  IF p_tax_deductible_amount IS NOT NULL AND p_tax_deductible_amount > 0 THEN
    -- Multi-year depreciation: use scheduled amount for this year, apply percentage
    RETURN ROUND(p_tax_deductible_amount * p_tax_deductible_percentage / 100, 2);
  ELSE
    -- Immediate deduction: use net amount, apply percentage
    RETURN ROUND(p_net_amount * COALESCE(p_tax_deductible_percentage, 100) / 100, 2);
  END IF;
END;
$$;


--
-- Name: FUNCTION calculate_deductible_amount(p_net_amount numeric, p_tax_deductible_percentage numeric, p_tax_deductible_amount numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calculate_deductible_amount(p_net_amount numeric, p_tax_deductible_percentage numeric, p_tax_deductible_amount numeric) IS 'Calculate actual tax-deductible amount from net amount, deductibility %, and depreciation schedule';


--
-- Name: get_bucket_type(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_bucket_type(url text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF url LIKE '/user-%' THEN
    RETURN 'per-user';
  ELSIF url LIKE '/receipts/%' OR url LIKE '/logos/%' OR url LIKE '/documents/%' THEN
    RETURN 'shared';
  ELSE
    RETURN 'unknown';
  END IF;
END;
$$;


--
-- Name: FUNCTION get_bucket_type(url text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_bucket_type(url text) IS 'Identifies whether a MinIO URL uses the old shared bucket structure or new per-user bucket structure';


--
-- Name: get_depreciation_amount_for_year(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_depreciation_amount_for_year(p_user_id uuid, p_year integer) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  total_amount NUMERIC(10,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0)
  INTO total_amount
  FROM expense_depreciation_schedule
  WHERE user_id = p_user_id AND year = p_year;
  
  RETURN total_amount;
END;
$$;


--
-- Name: FUNCTION get_depreciation_amount_for_year(p_user_id uuid, p_year integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_depreciation_amount_for_year(p_user_id uuid, p_year integer) IS 'Calculate total depreciation amount for a user in a specific year';


--
-- Name: trigger_set_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    contact_person character varying(255),
    email character varying(255),
    phone character varying(50),
    address text,
    city character varying(100),
    state character varying(100),
    postal_code character varying(20),
    country character varying(100),
    tax_id character varying(100),
    use_separate_billing_address boolean DEFAULT false,
    billing_contact_person character varying(255),
    billing_email character varying(255),
    billing_phone character varying(50),
    billing_address text,
    billing_city character varying(100),
    billing_state character varying(100),
    billing_postal_code character varying(20),
    billing_country character varying(100),
    status character varying(20) DEFAULT 'active'::character varying,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT clients_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('inactive'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: TABLE clients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.clients IS 'Client contact information and billing details';


--
-- Name: COLUMN clients.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: expense_depreciation_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_depreciation_schedule (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    expense_id uuid NOT NULL,
    user_id uuid NOT NULL,
    year integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    cumulative_amount numeric(10,2) NOT NULL,
    remaining_value numeric(10,2) NOT NULL,
    is_final_year boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT expense_depreciation_schedule_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT expense_depreciation_schedule_cumulative_check CHECK ((cumulative_amount >= (0)::numeric)),
    CONSTRAINT expense_depreciation_schedule_remaining_check CHECK ((remaining_value >= (0)::numeric)),
    CONSTRAINT expense_depreciation_schedule_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);


--
-- Name: TABLE expense_depreciation_schedule; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expense_depreciation_schedule IS 'Multi-year depreciation schedule for expenses (AfA-Abschreibungsplan)';


--
-- Name: COLUMN expense_depreciation_schedule.expense_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.expense_id IS 'Reference to the expense being depreciated';


--
-- Name: COLUMN expense_depreciation_schedule.year; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.year IS 'Calendar year for this depreciation entry';


--
-- Name: COLUMN expense_depreciation_schedule.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.amount IS 'Depreciation amount for this year';


--
-- Name: COLUMN expense_depreciation_schedule.cumulative_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.cumulative_amount IS 'Total depreciation up to and including this year';


--
-- Name: COLUMN expense_depreciation_schedule.remaining_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.remaining_value IS 'Remaining value after this year''s depreciation';


--
-- Name: COLUMN expense_depreciation_schedule.is_final_year; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_depreciation_schedule.is_final_year IS 'Whether this is the last year of depreciation';


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL,
    expense_date date NOT NULL,
    receipt_url text,
    is_billable boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    currency character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    receipt_filename character varying(255),
    receipt_size integer,
    receipt_mimetype character varying(100),
    is_reimbursable boolean DEFAULT false,
    status character varying(20) DEFAULT 'approved'::character varying,
    tags text[] DEFAULT '{}'::text[],
    notes text,
    tax_rate numeric(5,2) DEFAULT 0,
    tax_amount numeric(10,2) DEFAULT 0,
    net_amount numeric(10,2) DEFAULT 0 NOT NULL,
    category character varying(50) NOT NULL,
    is_recurring boolean DEFAULT false NOT NULL,
    recurrence_frequency character varying(20),
    recurrence_start_date date,
    recurrence_end_date date,
    parent_expense_id uuid,
    next_occurrence date,
    depreciation_type character varying(20) DEFAULT 'none'::character varying,
    depreciation_years integer,
    depreciation_start_date date,
    useful_life_category character varying(100),
    tax_deductible_amount numeric(10,2),
    ai_analysis_performed boolean DEFAULT false,
    ai_recommendation text,
    ai_analyzed_at timestamp with time zone,
    depreciation_method character varying(20) DEFAULT 'linear'::character varying,
    tax_deductible_percentage numeric(5,2) DEFAULT 100.00,
    tax_deductibility_reasoning text,
    tax_deductibility_analysis_date timestamp with time zone,
    ai_analysis_response jsonb,
    CONSTRAINT expenses_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT expenses_amount_equals_net_plus_tax CHECK ((abs((amount - (net_amount + tax_amount))) < 0.01)),
    CONSTRAINT expenses_depreciation_method_check CHECK (((depreciation_method)::text = ANY ((ARRAY['linear'::character varying, 'degressive'::character varying])::text[]))),
    CONSTRAINT expenses_depreciation_type_check CHECK (((depreciation_type)::text = ANY ((ARRAY['none'::character varying, 'immediate'::character varying, 'partial'::character varying])::text[]))),
    CONSTRAINT expenses_depreciation_years_check CHECK (((depreciation_years IS NULL) OR ((depreciation_years >= 1) AND (depreciation_years <= 50)))),
    CONSTRAINT expenses_no_depreciation_check CHECK ((((depreciation_type)::text = 'partial'::text) OR (((depreciation_type)::text = ANY ((ARRAY['none'::character varying, 'immediate'::character varying])::text[])) AND (depreciation_years IS NULL)))),
    CONSTRAINT expenses_partial_depreciation_check CHECK ((((depreciation_type)::text <> 'partial'::text) OR (((depreciation_type)::text = 'partial'::text) AND (depreciation_years IS NOT NULL) AND (depreciation_start_date IS NOT NULL)))),
    CONSTRAINT expenses_recurrence_frequency_check CHECK ((((is_recurring = false) AND (recurrence_frequency IS NULL)) OR ((is_recurring = true) AND ((recurrence_frequency)::text = ANY ((ARRAY['monthly'::character varying, 'quarterly'::character varying, 'yearly'::character varying])::text[]))))),
    CONSTRAINT expenses_recurring_date_range_check CHECK (((recurrence_end_date IS NULL) OR (recurrence_end_date > recurrence_start_date))),
    CONSTRAINT expenses_recurring_start_date_check CHECK (((is_recurring = false) OR ((is_recurring = true) AND (recurrence_start_date IS NOT NULL)))),
    CONSTRAINT expenses_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'reimbursed'::character varying])::text[]))),
    CONSTRAINT expenses_tax_amount_check CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT expenses_tax_deductible_check CHECK (((tax_deductible_amount IS NULL) OR ((tax_deductible_amount >= (0)::numeric) AND (tax_deductible_amount <= (net_amount + 0.01))))),
    CONSTRAINT expenses_tax_deductible_percentage_check CHECK (((tax_deductible_percentage >= (0)::numeric) AND (tax_deductible_percentage <= (100)::numeric))),
    CONSTRAINT expenses_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric)))
);


--
-- Name: TABLE expenses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expenses IS 'Expense tracking with receipt storage. Receipt URLs may use either shared buckets (/receipts/...) or per-user buckets (/user-{userId}/...)';


--
-- Name: COLUMN expenses.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.user_id IS 'Keycloak user ID who created the expense';


--
-- Name: COLUMN expenses.project_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.project_id IS 'Optional project assignment for expense allocation';


--
-- Name: COLUMN expenses.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.amount IS 'Total amount including tax. Should equal net_amount + tax_amount';


--
-- Name: COLUMN expenses.is_billable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.is_billable IS 'Whether this expense can be billed to a client';


--
-- Name: COLUMN expenses.receipt_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.receipt_size IS 'Receipt file size in bytes';


--
-- Name: COLUMN expenses.receipt_mimetype; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.receipt_mimetype IS 'Receipt file MIME type (e.g., application/pdf, image/jpeg)';


--
-- Name: COLUMN expenses.is_reimbursable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.is_reimbursable IS 'Whether this expense should be reimbursed to the user';


--
-- Name: COLUMN expenses.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.status IS 'Approval status: pending, approved, rejected, or reimbursed';


--
-- Name: COLUMN expenses.tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_rate IS 'Tax rate as percentage (e.g., 19.00 for 19% German VAT)';


--
-- Name: COLUMN expenses.tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_amount IS 'Tax amount in currency (calculated from net_amount * tax_rate / 100)';


--
-- Name: COLUMN expenses.net_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.net_amount IS 'Amount before tax (net). Total amount = net_amount + tax_amount';


--
-- Name: COLUMN expenses.depreciation_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.depreciation_type IS 'Type of depreciation: none (no special treatment), immediate (GWG < 800 EUR), partial (multi-year AfA)';


--
-- Name: COLUMN expenses.depreciation_years; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.depreciation_years IS 'Useful life in years according to AfA-Tabelle (1-50 years)';


--
-- Name: COLUMN expenses.depreciation_start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.depreciation_start_date IS 'Start date for depreciation (for pro-rata calculation)';


--
-- Name: COLUMN expenses.useful_life_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.useful_life_category IS 'Asset category from AfA-Tabelle (e.g., Computer/Laptop, Büromöbel, PKW)';


--
-- Name: COLUMN expenses.tax_deductible_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_deductible_amount IS 'Amount that is tax-deductible in the year of expense_date (for multi-year depreciation)';


--
-- Name: COLUMN expenses.ai_analysis_performed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.ai_analysis_performed IS 'Whether AI has analyzed this expense for depreciation recommendations';


--
-- Name: COLUMN expenses.ai_recommendation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.ai_recommendation IS 'JSON string containing AI analysis: recommendation, reasoning, suggested_years, references';


--
-- Name: COLUMN expenses.ai_analyzed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.ai_analyzed_at IS 'When AI analysis was last performed for this expense';


--
-- Name: COLUMN expenses.depreciation_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.depreciation_method IS 'Depreciation method: linear (standard AfA) or degressive (30% 2025-2027)';


--
-- Name: COLUMN expenses.tax_deductible_percentage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_deductible_percentage IS 'Percentage of expense that is tax-deductible (0-100). Default 100% for business expenses.';


--
-- Name: COLUMN expenses.tax_deductibility_reasoning; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_deductibility_reasoning IS 'AI-generated explanation of why this percentage is tax-deductible, including legal references and reasoning';


--
-- Name: COLUMN expenses.tax_deductibility_analysis_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.tax_deductibility_analysis_date IS 'When AI last analyzed the tax deductibility of this expense';


--
-- Name: COLUMN expenses.ai_analysis_response; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.ai_analysis_response IS 'Complete AI analysis response (JSON) as sent to frontend - includes confidence, reasoning, sources, suggested_category, etc. Cleared when re-analyzing or if analysis fails.';


--
-- Name: expense_tax_deductible_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.expense_tax_deductible_summary AS
 SELECT id,
    user_id,
    expense_date,
    description,
    category,
    net_amount,
    tax_deductible_percentage,
    tax_deductible_amount AS depreciation_yearly_amount,
    public.calculate_deductible_amount(net_amount, tax_deductible_percentage, tax_deductible_amount) AS actual_deductible_amount,
    depreciation_type,
    depreciation_years,
    tax_deductibility_reasoning,
    EXTRACT(year FROM expense_date) AS expense_year
   FROM public.expenses e
  WHERE ((status)::text = 'approved'::text);


--
-- Name: VIEW expense_tax_deductible_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.expense_tax_deductible_summary IS 'Summary of tax-deductible amounts per expense, combining depreciation schedule and deductibility percentage';


--
-- Name: invoice_details_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.invoice_details_view AS
SELECT
    NULL::uuid AS id,
    NULL::uuid AS user_id,
    NULL::uuid AS client_id,
    NULL::uuid AS project_id,
    NULL::character varying(50) AS invoice_number,
    NULL::date AS issue_date,
    NULL::date AS due_date,
    NULL::character varying(20) AS status,
    NULL::numeric(12,2) AS sub_total,
    NULL::numeric(5,4) AS tax_rate,
    NULL::numeric(12,2) AS tax_amount,
    NULL::numeric(12,2) AS total_amount,
    NULL::character varying(3) AS currency,
    NULL::character varying(50) AS tax_rate_id,
    NULL::text AS invoice_text,
    NULL::text AS footer_text,
    NULL::text AS tax_exemption_text,
    NULL::text AS notes,
    NULL::text AS terms,
    NULL::timestamp with time zone AS created_at,
    NULL::timestamp with time zone AS updated_at,
    NULL::character varying(255) AS client_name,
    NULL::character varying(255) AS client_email,
    NULL::bigint AS item_count,
    NULL::numeric AS paid_amount;


--
-- Name: VIEW invoice_details_view; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.invoice_details_view IS 'Aggregated invoice data with client info and payment totals';


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    invoice_id uuid NOT NULL,
    time_entry_id uuid,
    description text NOT NULL,
    quantity numeric(10,2) DEFAULT 1.00 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    amount numeric(12,2),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_price numeric(12,2),
    rate_type character varying(10) DEFAULT 'hourly'::character varying
);


--
-- Name: TABLE invoice_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_items IS 'Line items for invoices with optional time entry linkage';


--
-- Name: invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_text_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_text_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0
);


--
-- Name: TABLE invoice_text_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_text_templates IS 'Customizable text templates for invoice generation';


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    project_id uuid,
    invoice_number character varying(50) NOT NULL,
    issue_date date NOT NULL,
    due_date date NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying,
    sub_total numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) DEFAULT 0,
    currency character varying(3) DEFAULT 'EUR'::character varying,
    notes text,
    terms text,
    invoice_text text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    tax_rate numeric(5,4) DEFAULT 0,
    tax_rate_id character varying(50),
    footer_text text,
    tax_exemption_text text,
    enable_zugferd boolean DEFAULT false NOT NULL,
    invoice_headline character varying(255),
    header_template_id uuid,
    footer_template_id uuid,
    terms_template_id uuid,
    delivery_date character varying(20),
    exclude_from_tax boolean DEFAULT false NOT NULL,
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'partially_paid'::character varying, 'paid'::character varying, 'overdue'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: TABLE invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoices IS 'Invoice headers with status and totals';


--
-- Name: COLUMN invoices.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN invoices.enable_zugferd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.enable_zugferd IS 'Enable ZUGFeRD/Factur-X XML embedding for e-invoice compliance (EN 16931)';


--
-- Name: COLUMN invoices.invoice_headline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.invoice_headline IS 'Optional custom headline for the invoice (supports placeholders)';


--
-- Name: COLUMN invoices.header_template_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.header_template_id IS 'Reference to invoice_text_templates for header/introduction text';


--
-- Name: COLUMN invoices.footer_template_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.footer_template_id IS 'Reference to invoice_text_templates for footer/closing text';


--
-- Name: COLUMN invoices.terms_template_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.terms_template_id IS 'Reference to invoice_text_templates for payment terms';


--
-- Name: COLUMN invoices.exclude_from_tax; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.exclude_from_tax IS 'Whether to exclude this invoice from tax declarations and reports (e.g., for non-taxable income)';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    invoice_id uuid,
    payment_date date,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    client_id uuid,
    currency character varying(3) DEFAULT 'EUR'::character varying,
    transaction_id character varying(100),
    payment_type character varying(20) DEFAULT 'payment'::character varying NOT NULL,
    is_billable boolean DEFAULT false,
    notes text,
    project_id uuid,
    exclude_from_tax boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT payments_invoice_or_recurring CHECK (((((payment_type)::text = 'payment'::text) AND (((invoice_id IS NOT NULL) AND (client_id IS NOT NULL)) OR ((invoice_id IS NULL) AND (client_id IS NOT NULL)))) OR (((payment_type)::text = 'refund'::text) AND (invoice_id IS NOT NULL) AND (client_id IS NOT NULL)) OR ((payment_type)::text = ANY ((ARRAY['vat_refund'::character varying, 'income_tax_refund'::character varying])::text[])))),
    CONSTRAINT payments_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['payment'::character varying, 'refund'::character varying, 'vat_refund'::character varying, 'income_tax_refund'::character varying])::text[])))
);


--
-- Name: TABLE payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payments IS 'Payment and refund tracking for invoices';


--
-- Name: COLUMN payments.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN payments.project_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.project_id IS 'Optional project reference for recurring payments without invoices';


--
-- Name: COLUMN payments.exclude_from_tax; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.exclude_from_tax IS 'Whether to exclude this payment from tax declarations and reports';


--
-- Name: CONSTRAINT payments_payment_type_check ON payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT payments_payment_type_check ON public.payments IS 'Valid payment types: payment (income), refund (client refund), vat_refund (VAT refund from tax authority), income_tax_refund (income tax refund from tax authority)';


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid,
    name character varying(255) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying,
    hourly_rate numeric(10,2),
    budget numeric(12,2),
    rate_type character varying(20),
    estimated_hours numeric(10,2),
    currency character varying(3) DEFAULT 'EUR'::character varying,
    tags text[],
    start_date date,
    end_date date,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    recurring_payment boolean DEFAULT false NOT NULL,
    CONSTRAINT projects_rate_type_check CHECK (((rate_type)::text = ANY (ARRAY[('hourly'::character varying)::text, ('fixed_fee'::character varying)::text]))),
    CONSTRAINT projects_status_check CHECK (((status)::text = ANY (ARRAY[('not_started'::character varying)::text, ('active'::character varying)::text, ('completed'::character varying)::text, ('on_hold'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: TABLE projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.projects IS 'Projects associated with clients';


--
-- Name: COLUMN projects.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN projects.recurring_payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.recurring_payment IS 'Indicates if this project has recurring monthly payments without invoices (e.g., fixed monthly retainer)';


--
-- Name: report_export_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_export_audit (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    report_type character varying(50) NOT NULL,
    export_format character varying(20) NOT NULL,
    file_url text NOT NULL,
    bucket_type character varying(20) NOT NULL,
    parameters jsonb,
    file_size_bytes bigint,
    generated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE report_export_audit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.report_export_audit IS 'Tracks all report exports for audit trail and file management';


--
-- Name: COLUMN report_export_audit.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.report_export_audit.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN report_export_audit.bucket_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.report_export_audit.bucket_type IS 'Storage bucket type: per-user or shared';


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    company_name character varying(255),
    company_address text,
    company_city character varying(100),
    company_state character varying(100),
    company_postal_code character varying(20),
    company_country character varying(100),
    company_tax_id character varying(100),
    company_email character varying(255),
    company_phone character varying(50),
    company_website character varying(255),
    company_logo_url text,
    invoice_prefix character varying(20) DEFAULT 'INV'::character varying,
    invoice_number_start integer DEFAULT 1,
    invoice_number_current integer DEFAULT 1,
    default_tax_rate numeric(5,2) DEFAULT 0.00,
    default_currency character varying(3) DEFAULT 'EUR'::character varying,
    default_payment_terms integer DEFAULT 30,
    bank_name character varying(255),
    bank_iban character varying(50),
    bank_bic character varying(20),
    bank_account_holder character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    company_subline character varying(255),
    ai_enabled boolean DEFAULT false,
    ai_provider character varying(50) DEFAULT 'lm_studio'::character varying,
    ai_api_url character varying(512),
    ai_api_key character varying(512),
    ai_model character varying(255),
    mcp_server_url character varying(512),
    mcp_server_api_key character varying(512),
    user_region character varying(2)
);


--
-- Name: TABLE settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.settings IS 'User-specific application and company settings';


--
-- Name: COLUMN settings.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN settings.company_subline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.company_subline IS 'Company tagline or subline displayed under company name on invoices';


--
-- Name: COLUMN settings.user_region; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.user_region IS 'User region/state code (e.g., DE state code like BW, BY) for timezone and holiday handling';


--
-- Name: system_backup_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_backup_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_name character varying(255) NOT NULL,
    cron_expression character varying(100) NOT NULL,
    backup_type character varying(50) DEFAULT 'scheduled'::character varying NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    retention_days integer DEFAULT 30,
    includes_database boolean DEFAULT true,
    includes_storage boolean DEFAULT true,
    includes_config boolean DEFAULT false,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE system_backup_schedule; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_backup_schedule IS 'Configuration for scheduled automatic backups';


--
-- Name: COLUMN system_backup_schedule.cron_expression; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backup_schedule.cron_expression IS 'Cron expression for backup schedule (e.g., "0 2 * * *" for daily at 2 AM)';


--
-- Name: COLUMN system_backup_schedule.retention_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backup_schedule.retention_days IS 'Number of days to keep backups before deletion';


--
-- Name: system_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backup_name character varying(255) NOT NULL,
    backup_type character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    backup_path text,
    file_size_bytes bigint,
    includes_database boolean DEFAULT true,
    includes_storage boolean DEFAULT true,
    includes_config boolean DEFAULT false,
    started_by character varying(255),
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT system_backups_backup_type_check CHECK (((backup_type)::text = ANY ((ARRAY['manual'::character varying, 'scheduled'::character varying, 'auto'::character varying])::text[]))),
    CONSTRAINT system_backups_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE system_backups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_backups IS 'Tracks all system backup operations';


--
-- Name: COLUMN system_backups.backup_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backups.backup_type IS 'Type: manual (user triggered), scheduled (auto by schedule), auto (on-demand)';


--
-- Name: COLUMN system_backups.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backups.status IS 'Current status of backup operation';


--
-- Name: COLUMN system_backups.backup_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backups.backup_path IS 'Full path to backup file or directory';


--
-- Name: COLUMN system_backups.started_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_backups.started_by IS 'Keycloak user ID who triggered the backup';


--
-- Name: system_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_migrations (
    id integer NOT NULL,
    migration_name character varying(255) NOT NULL,
    executed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE system_migrations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_migrations IS 'Tracks database migrations that have been applied';


--
-- Name: system_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_migrations_id_seq OWNED BY public.system_migrations.id;


--
-- Name: tax_prepayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_prepayments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tax_type character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_date date NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    tax_year integer NOT NULL,
    quarter integer,
    description text,
    reference_number character varying(100),
    payment_method character varying(50),
    receipt_url text,
    receipt_filename character varying(255),
    receipt_size integer,
    receipt_mimetype character varying(100),
    notes text,
    status character varying(20) DEFAULT 'paid'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tax_prepayments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT tax_prepayments_quarter_check CHECK (((quarter >= 1) AND (quarter <= 4))),
    CONSTRAINT tax_prepayments_status_check CHECK (((status)::text = ANY ((ARRAY['paid'::character varying, 'planned'::character varying, 'cancelled'::character varying, 'refund'::character varying])::text[]))),
    CONSTRAINT tax_prepayments_tax_type_check CHECK (((tax_type)::text = ANY ((ARRAY['vat'::character varying, 'income_tax'::character varying])::text[])))
);


--
-- Name: TABLE tax_prepayments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tax_prepayments IS 'Tax prepayments tracking for VAT and income tax advance payments';


--
-- Name: COLUMN tax_prepayments.tax_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tax_prepayments.tax_type IS 'Type of tax: vat (Umsatzsteuervorauszahlung) or income_tax (Einkommensteuervorauszahlung)';


--
-- Name: COLUMN tax_prepayments.quarter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tax_prepayments.quarter IS 'Quarter (1-4) for quarterly payments, NULL for annual payments';


--
-- Name: CONSTRAINT tax_prepayments_status_check ON tax_prepayments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT tax_prepayments_status_check ON public.tax_prepayments IS 'Valid statuses: paid (tax paid to authority), planned (scheduled payment), cancelled (payment cancelled), refund (tax refund received from authority)';


--
-- Name: tax_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    rate numeric(5,2) NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    description text,
    is_active boolean DEFAULT true,
    country_code character varying(2),
    sort_order integer DEFAULT 0
);


--
-- Name: TABLE tax_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tax_rates IS 'User-configurable tax rates for invoices';


--
-- Name: COLUMN tax_rates.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tax_rates.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    task_name character varying(255),
    description text DEFAULT ''::text NOT NULL,
    entry_date date NOT NULL,
    entry_time time without time zone NOT NULL,
    entry_end_time time without time zone,
    duration_hours numeric(10,2) NOT NULL,
    category character varying(100),
    is_billable boolean DEFAULT true NOT NULL,
    hourly_rate numeric(10,2),
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    date_start timestamp with time zone
);


--
-- Name: TABLE time_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.time_entries IS 'Time tracking entries with single date/time per entry. Users create separate entries for work spanning midnight.';


--
-- Name: COLUMN time_entries.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.user_id IS 'Keycloak user ID (sub claim from JWT token)';


--
-- Name: COLUMN time_entries.entry_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.entry_date IS 'Date of work performed (YYYY-MM-DD)';


--
-- Name: COLUMN time_entries.entry_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.entry_time IS 'Time when work started (HH:MM:SS)';


--
-- Name: COLUMN time_entries.entry_end_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.entry_end_time IS 'Time when work ended (HH:MM:SS), optional - used for preserving user input';


--
-- Name: COLUMN time_entries.duration_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.duration_hours IS 'Duration of work in hours (decimal, e.g., 2.5 for 2h 30m) - used for invoicing';


--
-- Name: COLUMN time_entries.date_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_entries.date_start IS 'Legacy: Timestamp for running timer entries (NULL when timer stopped)';


--
-- Name: v_expenses_with_depreciation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_expenses_with_depreciation AS
 SELECT e.id,
    e.user_id,
    e.project_id,
    e.description,
    e.amount,
    e.expense_date,
    e.receipt_url,
    e.is_billable,
    e.created_at,
    e.updated_at,
    e.currency,
    e.receipt_filename,
    e.receipt_size,
    e.receipt_mimetype,
    e.is_reimbursable,
    e.status,
    e.tags,
    e.notes,
    e.tax_rate,
    e.tax_amount,
    e.net_amount,
    e.category,
    e.is_recurring,
    e.recurrence_frequency,
    e.recurrence_start_date,
    e.recurrence_end_date,
    e.parent_expense_id,
    e.next_occurrence,
    e.depreciation_type,
    e.depreciation_years,
    e.depreciation_start_date,
    e.useful_life_category,
    e.tax_deductible_amount,
    e.ai_analysis_performed,
    e.ai_recommendation,
    e.ai_analyzed_at,
    e.depreciation_method,
        CASE
            WHEN ((e.depreciation_type)::text = 'partial'::text) THEN e.tax_deductible_amount
            ELSE e.net_amount
        END AS current_year_deductible,
        CASE
            WHEN ((e.depreciation_type)::text = 'partial'::text) THEN (e.net_amount - COALESCE(e.tax_deductible_amount, (0)::numeric))
            ELSE (0)::numeric
        END AS deferred_amount,
    eds.year AS depreciation_year,
    eds.amount AS depreciation_amount,
    eds.cumulative_amount AS depreciation_cumulative,
    eds.remaining_value AS depreciation_remaining
   FROM (public.expenses e
     LEFT JOIN public.expense_depreciation_schedule eds ON ((e.id = eds.expense_id)));


--
-- Name: VIEW v_expenses_with_depreciation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_expenses_with_depreciation IS 'Expenses joined with their depreciation schedules for easy reporting';


--
-- Name: system_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_migrations ALTER COLUMN id SET DEFAULT nextval('public.system_migrations_id_seq'::regclass);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: expense_depreciation_schedule expense_depreciation_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_depreciation_schedule
    ADD CONSTRAINT expense_depreciation_schedule_pkey PRIMARY KEY (id);


--
-- Name: expense_depreciation_schedule expense_depreciation_schedule_unique_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_depreciation_schedule
    ADD CONSTRAINT expense_depreciation_schedule_unique_year UNIQUE (expense_id, year);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_text_templates invoice_text_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_text_templates
    ADD CONSTRAINT invoice_text_templates_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: report_export_audit report_export_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_export_audit
    ADD CONSTRAINT report_export_audit_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_key UNIQUE (user_id);


--
-- Name: system_backup_schedule system_backup_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backup_schedule
    ADD CONSTRAINT system_backup_schedule_pkey PRIMARY KEY (id);


--
-- Name: system_backups system_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backups
    ADD CONSTRAINT system_backups_pkey PRIMARY KEY (id);


--
-- Name: system_migrations system_migrations_migration_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_migrations
    ADD CONSTRAINT system_migrations_migration_name_key UNIQUE (migration_name);


--
-- Name: system_migrations system_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_migrations
    ADD CONSTRAINT system_migrations_pkey PRIMARY KEY (id);


--
-- Name: tax_prepayments tax_prepayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_prepayments
    ADD CONSTRAINT tax_prepayments_pkey PRIMARY KEY (id);


--
-- Name: tax_rates tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: idx_backup_schedule_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_schedule_enabled ON public.system_backup_schedule USING btree (is_enabled);


--
-- Name: idx_backup_schedule_next_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_schedule_next_run ON public.system_backup_schedule USING btree (next_run_at);


--
-- Name: idx_clients_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_is_active ON public.clients USING btree (is_active);


--
-- Name: idx_clients_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_name ON public.clients USING btree (name);


--
-- Name: idx_clients_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_user_id ON public.clients USING btree (user_id);


--
-- Name: idx_depreciation_schedule_expense; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_depreciation_schedule_expense ON public.expense_depreciation_schedule USING btree (expense_id);


--
-- Name: idx_depreciation_schedule_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_depreciation_schedule_year ON public.expense_depreciation_schedule USING btree (year, user_id);


--
-- Name: idx_expenses_ai_analyzed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_ai_analyzed ON public.expenses USING btree (ai_analysis_performed, user_id) WHERE (ai_analysis_performed = true);


--
-- Name: idx_expenses_category_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_category_amount ON public.expenses USING btree (category, net_amount, user_id);


--
-- Name: idx_expenses_deductibility_analysis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_deductibility_analysis ON public.expenses USING btree (tax_deductibility_analysis_date) WHERE (tax_deductibility_analysis_date IS NULL);


--
-- Name: idx_expenses_deductible_percentage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_deductible_percentage ON public.expenses USING btree (user_id, expense_date, tax_deductible_percentage) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_expenses_depreciation_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_depreciation_type ON public.expenses USING btree (depreciation_type, user_id) WHERE ((depreciation_type)::text = 'partial'::text);


--
-- Name: idx_expenses_expense_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_expense_date ON public.expenses USING btree (expense_date);


--
-- Name: idx_expenses_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_parent_id ON public.expenses USING btree (parent_expense_id) WHERE (parent_expense_id IS NOT NULL);


--
-- Name: idx_expenses_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_project_id ON public.expenses USING btree (project_id);


--
-- Name: idx_expenses_recurring_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_recurring_active ON public.expenses USING btree (is_recurring, next_occurrence) WHERE ((is_recurring = true) AND ((status)::text <> 'rejected'::text));


--
-- Name: idx_expenses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_user_id ON public.expenses USING btree (user_id);


--
-- Name: idx_invoice_items_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice_id ON public.invoice_items USING btree (invoice_id);


--
-- Name: idx_invoice_items_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_time_entry_id ON public.invoice_items USING btree (time_entry_id);


--
-- Name: idx_invoice_text_templates_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_text_templates_user_id ON public.invoice_text_templates USING btree (user_id);


--
-- Name: idx_invoices_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_client_id ON public.invoices USING btree (client_id);


--
-- Name: idx_invoices_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_invoice_date ON public.invoices USING btree (issue_date);


--
-- Name: idx_invoices_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_project_id ON public.invoices USING btree (project_id);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_user_id ON public.invoices USING btree (user_id);


--
-- Name: idx_payments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_invoice_id ON public.payments USING btree (invoice_id);


--
-- Name: idx_payments_payment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_payment_date ON public.payments USING btree (payment_date);


--
-- Name: idx_projects_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_client_id ON public.projects USING btree (client_id);


--
-- Name: idx_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_status ON public.projects USING btree (status);


--
-- Name: idx_projects_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_user_id ON public.projects USING btree (user_id);


--
-- Name: idx_report_export_audit_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_export_audit_expires_at ON public.report_export_audit USING btree (expires_at);


--
-- Name: idx_report_export_audit_generated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_export_audit_generated_at ON public.report_export_audit USING btree (generated_at);


--
-- Name: idx_report_export_audit_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_export_audit_user_id ON public.report_export_audit USING btree (user_id);


--
-- Name: idx_system_backups_backup_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_backups_backup_type ON public.system_backups USING btree (backup_type);


--
-- Name: idx_system_backups_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_backups_started_at ON public.system_backups USING btree (started_at DESC);


--
-- Name: idx_system_backups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_backups_status ON public.system_backups USING btree (status);


--
-- Name: idx_tax_prepayments_payment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_prepayments_payment_date ON public.tax_prepayments USING btree (payment_date);


--
-- Name: idx_tax_prepayments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_prepayments_status ON public.tax_prepayments USING btree (status);


--
-- Name: idx_tax_prepayments_tax_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_prepayments_tax_type ON public.tax_prepayments USING btree (tax_type);


--
-- Name: idx_tax_prepayments_tax_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_prepayments_tax_year ON public.tax_prepayments USING btree (tax_year);


--
-- Name: idx_tax_prepayments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_prepayments_user_id ON public.tax_prepayments USING btree (user_id);


--
-- Name: idx_tax_rates_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rates_user_id ON public.tax_rates USING btree (user_id);


--
-- Name: idx_time_entries_date_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_date_start ON public.time_entries USING btree (date_start) WHERE (date_start IS NOT NULL);


--
-- Name: idx_time_entries_entry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_entry_date ON public.time_entries USING btree (entry_date);


--
-- Name: idx_time_entries_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_project_id ON public.time_entries USING btree (project_id);


--
-- Name: idx_time_entries_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_user_id ON public.time_entries USING btree (user_id);


--
-- Name: invoice_details_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.invoice_details_view AS
 SELECT i.id,
    i.user_id,
    i.client_id,
    i.project_id,
    i.invoice_number,
    i.issue_date,
    i.due_date,
    i.status,
    i.sub_total,
    i.tax_rate,
    i.tax_amount,
    i.total_amount,
    i.currency,
    i.tax_rate_id,
    i.invoice_text,
    i.footer_text,
    i.tax_exemption_text,
    i.notes,
    i.terms,
    i.created_at,
    i.updated_at,
    c.name AS client_name,
    c.email AS client_email,
    count(DISTINCT ii.id) AS item_count,
    COALESCE(sum(p.amount), (0)::numeric) AS paid_amount
   FROM (((public.invoices i
     LEFT JOIN public.clients c ON ((i.client_id = c.id)))
     LEFT JOIN public.invoice_items ii ON ((i.id = ii.invoice_id)))
     LEFT JOIN public.payments p ON (((i.id = p.invoice_id) AND ((p.payment_type)::text = 'payment'::text))))
  GROUP BY i.id, c.name, c.email;


--
-- Name: expenses set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: invoice_items set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: invoice_text_templates set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.invoice_text_templates FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: invoices set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: payments set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: settings set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: tax_rates set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.tax_rates FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: time_entries set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: clients set_timestamp_clients; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp_clients BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: expense_depreciation_schedule set_timestamp_depreciation_schedule; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp_depreciation_schedule BEFORE UPDATE ON public.expense_depreciation_schedule FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: projects set_timestamp_projects; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: expenses expenses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: expense_depreciation_schedule fk_expense; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_depreciation_schedule
    ADD CONSTRAINT fk_expense FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expenses fk_parent_expense; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT fk_parent_expense FOREIGN KEY (parent_expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_time_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_footer_template_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_footer_template_fkey FOREIGN KEY (footer_template_id) REFERENCES public.invoice_text_templates(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_header_template_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_header_template_fkey FOREIGN KEY (header_template_id) REFERENCES public.invoice_text_templates(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_terms_template_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_terms_template_fkey FOREIGN KEY (terms_template_id) REFERENCES public.invoice_text_templates(id) ON DELETE SET NULL;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: payments payments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: projects projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: tax_prepayments tax_prepayments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_prepayments
    ADD CONSTRAINT tax_prepayments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.settings(user_id) ON DELETE CASCADE;


--
-- Name: time_entries time_entries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


