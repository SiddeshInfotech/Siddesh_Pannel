// Canonical security-tier badge styling — single source of truth for the device security_tier
// taxonomy (src/app/api/activate/route.ts's zod enum: Android's KeystoreCrypto tiers plus
// Windows desktop's separate TpmSealing WIN_* tiers), shared by every dashboard that renders a
// device's tier (Monitoring, Update).
//
// Previously each page hand-copied this exact switch independently. One copy's WIN_* cases
// drifted out of sync with the other (missing entirely), so the whole Windows fleet showed "—"
// on that page regardless of its real reported tier — a real production bug caused by the
// duplication itself, not by either copy being wrong in isolation. Import from here; never
// re-declare this switch in a page component again.
export function tierStyle(tier: string): { label: string; cls: string } {
  switch (tier) {
    case 'ATTESTED_STRONGBOX':
      return { label: 'StrongBox', cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' };
    case 'ATTESTED_TEE':
      return { label: 'TEE (attested)', cls: 'bg-green-500/10 border-green-500/25 text-green-400' };
    case 'KEYSTORE_PLAIN':
      return { label: 'Keystore (no chain)', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400' };
    case 'TEE_LEGACY_NOATTEST':
      return { label: 'TEE legacy', cls: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400' };
    case 'MODEL_SKIP':
      return { label: 'Model skip', cls: 'bg-sky-500/10 border-sky-500/25 text-sky-400' };
    case 'SW_ONLY':
      return { label: 'Software only', cls: 'bg-orange-500/10 border-orange-500/25 text-orange-400' };
    case 'PROVISION_FAILED':
      return { label: 'Provision failed', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-400' };
    case 'CEK_DECRYPT_FAILED':
      return { label: 'CEK failed', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-400' };
    // Windows desktop (TpmSealing) tiers.
    case 'WIN_TPM_ATTESTED':
      return { label: 'Windows TPM (attested)', cls: 'bg-green-500/10 border-green-500/25 text-green-400' };
    case 'WIN_TPM_NOATTEST':
      return { label: 'Windows TPM', cls: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400' };
    case 'WIN_SW_ONLY':
      return { label: 'Windows (software)', cls: 'bg-orange-500/10 border-orange-500/25 text-orange-400' };
    default:
      return { label: 'Unreported', cls: 'bg-white/5 border-white/10 text-zinc-400' };
  }
}
