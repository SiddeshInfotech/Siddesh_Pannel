# Enterprise Form Implementation Guide: Vendor Management

When **large technology companies** (Google, Microsoft, Amazon, Meta, Stripe, Atlassian, Salesforce, etc.) build forms, they consider the entire data lifecycle. Below is the updated specification matching how we implemented these standards in the **Add Vendor Form** in the ERP Admin Panel.

---

# 1. User Experience (UX)

We designed the vendor registration with a multi-step tabbed interface to organize fields logically and prevent layout exhaustion.

| Enterprise Checklist Item | Add Vendor Implementation Details |
| :--- | :--- |
| **Responsive design** | Uses Tailwind flex/grid layout matching column widths to screen sizes (`grid-cols-1 md:grid-cols-2 lg:grid-cols-12`). |
| **Mobile-first layout** | The sidebar tabs collapse into single-column cards on smaller breakpoints. |
| **Clear labels & placeholders** | Every field includes semantic labels (e.g. `GST Number`) and sample inputs as placeholders (`e.g. 15-digit GSTIN`). |
| **Required field indicators** | Fields vital for business operations are marked with a prominent red asterisk (`*`). |
| **Inline validation** | Client checks field rules before advancing steps or submitting. |
| **Helpful error messages** | Triggers descriptive toast alerts (e.g. "Please fill out all required Contact fields") rather than generic console logs. |
| **Progress indicators** | Colored active icons (Building, User, FileText) in the left sidebar mark progress. |
| **Keyboard accessibility** | Inputs support semantic HTML layout allowing users to `Tab` between fields. |
| **Loading indicators** | Save button displays `Saving...` and disables itself during execution to prevent duplicate requests. |
| **Success confirmation** | Displays a toast message "Vendor successfully registered" and routes back to the dashboard. |

---

# 2. State Management

Form states are managed via React states and Next.js transitions.

| Form State | Add Vendor Implementation Details |
| :--- | :--- |
| **Idle** | Initial render of the form with default values (e.g. `status` default to `Active`). |
| **Editing** | Form fields are binded to local states, listening to input changes. |
| **Validating** | Intercepts submit handler, verifying schema constraints on client, then validates server-side using Zod. |
| **Uploading** | Converts files to Base64 asynchronously on the client and binds it to state. |
| **Submitting** | Handled by `useTransition` to track transition execution (`isPending`). |
| **Success / Failed** | Reacts to the response payload of `createVendor` by triggering successful redirects or showing errors. |

---

# 3. Validation

Double-layered validation provides defense-in-depth.

### Client Side
* **Form Steps Guards**: Validates core sections before submission.
* **Basic Fields**: Ensures Name, Vendor Type, and Business Category are specified.
* **Contact & Address**: Requires Contact Person Name, valid Email pattern, Pincode length, and Address details.

### Server Side
* **Zod Schema validation**: Server actions parse input values using a strict schema (`CreateVendorSchema`).
* **Format & Range**: Verifies phone lengths (`10-15 digits`), email addresses, and restricts inputs to safe string lengths.

| Validation Tier | Add Vendor Implementation Details |
| :--- | :--- |
| **Zod Schema Parsing** | Validates the entire payload on the server using `CreateVendorSchema.safeParse(formData)`. |
| **Regex Checks** | Enforces valid formats for mobile numbers (`/^\+?[0-9]{10,15}$/`) and pincodes (`/^[0-9]{5,10}$/`). |

---

# 4. Security

Security is integrated directly into the vendor controller pipeline.

| Security Aspect | Add Vendor Implementation Details |
| :--- | :--- |
| **SQL Injection & XSS** | Inputs are sanitized using a custom `sanitize()` filter before writing to PostgreSQL/local files. |
| **Authentication & Authorization** | Checks for active admin sessions using `getAdminSession()`. If unauthorized, requests are rejected immediately. |
| **MFA & Rate Limiting** | Handled at the session level by the server-side router and rate limiters. |
| **Secrets Protection** | Service Role keys and environment variables are strictly server-side (no `NEXT_PUBLIC_` prefixes on secrets). |

---

# 5. Performance

High-performance rendering patterns protect client memory limits.

| Performance Practice | Add Vendor Implementation Details |
| :--- | :--- |
| **Transition Hook** | Uses `useTransition` for server communication, allowing React to keep UI responsive during I/O processes. |
| **Lazy File Reading** | Converts files to Base64 in background memory before packing them into Server Action payload. |
| **State Separation** | Splits components logically (e.g., custom dropdowns vs. native inputs) to prevent general layout redraws. |

---

# 6. Database Design

The data schema is structured for persistence and consistency.

| Database Constraint | Add Vendor Implementation Details |
| :--- | :--- |
| **Unique IDs** | Generates human-readable unique `vendor_id` (`VND-[Year]-[Random]`) and `vendor_code` (`VND-CODE-[Random]`). |
| **Graceful Fallback** | Tries to write to PostgreSQL in Supabase. If the table does not exist, it falls back to writing safely to `/src/lib/vendors.json`. |
| **Strict Schema** | Adheres to field types: Boolean statuses, text descriptions, and ISO date strings. |

---

# 7. API Design

Actions are encapsulated inside Next.js Server Actions.

| API Element | Add Vendor Implementation Details |
| :--- | :--- |
| **Server Actions** | Implemented as `createVendor` inside `'use server'` scope for direct, secure RPC-like execution. |
| **Structured Responses** | Always returns an `ActionResult` format: `{ ok: true, data }` or `{ ok: false, error }`. |
| **Cache Invalidation** | Calls `revalidatePath('/vendors')` to clear server caches upon registration. |

---

# 8. File Upload Security

Uploaded files are processed securely to prevent common vectors.

| Upload Security Check | Add Vendor Implementation Details |
| :--- | :--- |
| **Mime Types & Extensions** | Form file inputs restrict uploads to images and PDF files (`accept="image/*,application/pdf"`). |
| **File Size Limit** | Explicitly checks that file size does not exceed 5MB on client before processing. |
| **Secure Directory Isolation** | Saves files using a prefix matching `vendor_id` to public uploads directory, preventing directory traversal. |

---

# 11. Error Handling

Errors are caught, sanitized, and logged.

| Error Scenario | Add Vendor Implementation Details |
| :--- | :--- |
| **Validation Failures** | Triggers error messages directly back to the UI indicating exactly which field failed rules. |
| **System Failures** | Catch blocks log database issues to the server logger (`logger.warn`) and show a generic failure notice. |

---

# 12. Data Integrity

Ensures vendor records remain accurate.

| Integrity Guard | Add Vendor Implementation Details |
| :--- | :--- |
| **Format Sanitization** | Automatically strips spaces, hyphens, and parenthesis from phone numbers before parsing. |
| **Timestamping** | Automatically stamps each entry with creation and update times. |
