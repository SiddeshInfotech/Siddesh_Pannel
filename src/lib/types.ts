// TypeScript interfaces for all Supabase tables
// Column names are snake_case matching PostgreSQL schema

export interface School {
  id: string;
  school_id: string | null;
  name: string;
  board: 'CBSE' | 'State Board' | 'ICSE' | 'IB' | 'IGCSE';
  mediums: string[];
  // Address (flat)
  street: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  // Contact (flat)
  coordinator_name?: string | null;
  email?: string | null;
  phone?: string | null;
  secondary_phone?: string | null;
  // Infrastructure (flat)
  classrooms_count: number;
  has_computer_lab: boolean;
  internet_access: 'BASIC' | 'BROADBAND' | 'OPTICAL FIBER';
  // Metadata
  logo_url?: string | null;
  status: 'Draft' | 'Active';
  academic_year?: string | null;
  section?: string | null;
  standard?: string | null;
  full_class_name?: string | null;
  legacy_mongo_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivationKey {
  id: string;
  batch_id?: string | null;
  school_id: string;
  payment_id?: string | null;
  key: string;
  status: 'Unpaid' | 'Paid' | 'Active' | 'Revoked';
  duration_days: number;
  device_fingerprint?: string | null;
  device_model?: string | null;
  device_os?: string | null;
  device_board?: string | null;
  device_brand?: string | null;
  device_device?: string | null;
  device_manufacturer?: string | null;
  device_android_id?: string | null;
  activated_at?: string | null;
  expires_at?: string | null;
  last_known_monotonic_time?: string | null;
  legacy_mongo_id?: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  school_id: string;
  amount: number;
  keys_count: number;
  payment_method: string;
  bank_name: string;
  transaction_id: string;
  payment_date: string;
  receipt_file_url?: string | null;
  status: 'Unpaid' | 'Pending Approval' | 'Paid';
  legacy_mongo_id?: string | null;
  created_at: string;
}

export interface HandshakeLog {
  id: string;
  activation_key: string;
  device_fingerprint: string;
  device_model: string;
  device_os: string;
  status: 'SUCCESS' | 'FAILED';
  error_message?: string | null;
  ip_address?: string | null;
  timestamp: string;
}

// Input types for creating records (omit auto-generated fields)
export type CreateSchoolInput = Omit<School, 'id' | 'created_at' | 'updated_at'>;
export type CreateActivationKeyInput = Omit<ActivationKey, 'id' | 'created_at'>;
export type CreatePaymentInput = Omit<Payment, 'id' | 'created_at'>;
export type CreateHandshakeLogInput = Omit<HandshakeLog, 'id' | 'timestamp'>;
