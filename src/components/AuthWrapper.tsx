'use client';

/**
 * AuthWrapper.tsx — Admin login overlay with Multi-Factor Authentication
 *
 * Security design:
 * - JWT in HttpOnly cookie set by /api/auth/login (XSS-proof, server-validated)
 * - Two-Phase login UI:
 *   - Phase 1: Email + Password.
 *   - Phase 2: OTP verify or recovery code bypass.
 * - MFA Setup: If mfaSetupRequired is true, prompts user to configure their TOTP app.
 * - Recovery Codes: Prompts user to download and save recovery codes on successful enrollment.
 */

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { AuthProvider } from '@/context/AuthContext';
import {
  Mail,
  Lock,
  ShieldAlert,
  Sparkles,
  LogIn,
  Eye,
  EyeOff,
  AlertTriangle,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import GlassCard from './GlassCard';

export default function AuthWrapper({
  children,
  sessionExists,
}: {
  children: React.ReactNode;
  sessionExists: boolean;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(sessionExists);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [shakeError, setShakeError] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState('');

  // MFA states
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  
  // Recovery Mode states
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const isSubmitting = React.useRef(false);

  // Generate QR Code
  useEffect(() => {
    if (mfaSetupRequired && totpSecret && email) {
      const uri = `otpauth://totp/Siddesh%20Tech%20Admin:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=Siddesh%20Tech`;
      QRCode.toDataURL(uri, { 
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      })
      .then(setQrCodeUrl)
      .catch(console.error);
    }
  }, [mfaSetupRequired, totpSecret, email]);

  // Sync auth status when server prop updates
  useEffect(() => {
    setIsAuthenticated(sessionExists);
  }, [sessionExists]);

  const triggerErrorShake = () => {
    setShakeError(true);
    setTimeout(() => setShakeError(false), 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.getModifierState) setIsCapsLockOn(e.getModifierState('CapsLock'));
  };

  const copySecretToClipboard = () => {
    navigator.clipboard.writeText(totpSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // ── Login Submit ──────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting.current) return;
    
    let isLoginSuccessful = false;

    setError('');
    setRateLimitMsg('');

    const cleanedEmail = email.trim();
    if (!challengeToken && (!cleanedEmail || !password)) {
      setError('Please fill in all fields.');
      triggerErrorShake();
      return;
    }
    if (challengeToken && !otpCode && !recoveryCode) {
      setError(isRecoveryMode ? 'Please enter a recovery code.' : 'Please enter a verification code.');
      triggerErrorShake();
      return;
    }

    isSubmitting.current = true;
    setLoading(true);
    try {
      const payload: any = {};
      if (challengeToken) {
        payload.challengeToken = challengeToken;
        if (isRecoveryMode) {
          payload.recoveryCode = recoveryCode.trim();
        } else {
          payload.code = otpCode;
        }
      } else {
        payload.email = cleanedEmail;
        payload.password = password;
      }

      const response = await fetch('/lms-admin/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.status === 429) {
        setRateLimitMsg(data.error || 'Too many attempts. Please wait.');
        triggerErrorShake();
        return;
      }

      if (response.ok && data.success) {
        if (data.recoveryCodes) {
          // Enrollment succeeded, display recovery codes
          setRecoveryCodes(data.recoveryCodes);
          setError('');
        } else {
          // Sign in succeeded. Do NOT clear states here to prevent UI flash.
          // The page will reload and the session will be read from the cookie.
          isLoginSuccessful = true;
          window.location.reload();
        }
      } else if (data.mfaRequired) {
        setMfaRequired(true);
        setChallengeToken(data.challengeToken);
        setMfaSetupRequired(!!data.mfaSetupRequired);
        if (data.totpSecret) {
          setTotpSecret(data.totpSecret);
        }
        setError('');
        setOtpCode('');
        setRecoveryCode('');
      } else {
        setError(data.error || 'Invalid credentials.');
        triggerErrorShake();
      }
    } catch {
      setError('Network error. Check your connection.');
      triggerErrorShake();
    } finally {
      if (!isLoginSuccessful) {
        isSubmitting.current = false;
        setLoading(false);
      }
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try {
      await fetch('/lms-admin/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      window.location.reload();
    }
  };

  // F-10 fix: logout function is now shared via React Context (AuthProvider below)
  // instead of being attached to window.__adminLogout which was accessible to XSS.

  // ── Render Recovery Codes Modal ──────────────────────────────────────────
  if (recoveryCodes.length > 0) {
    const downloadRecoveryCodes = () => {
      const content = `SIDDESH TECH LMS ADMIN PANEL\nRECOVERY CODES\n\nSave these codes in a secure place. Each code can be used once to bypass MFA.\n\n${recoveryCodes.join('\n')}\n\nGenerated on: ${new Date().toLocaleString()}`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'siddesh-lms-recovery-codes.txt';
      link.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in">
        <div className="w-full max-w-md relative z-10 animate-slide-up">
          <GlassCard className="/75 border border-white/10 p-8 rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-500 via-teal-500 to-accent-blue" />
            <div className="mb-6 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">MFA Setup Successful</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Here are your one-time use Recovery Codes. Save them securely.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 bg-white/[0.02] border border-white/5 rounded-2xl p-4 font-mono text-sm text-zinc-300 text-center mb-6 select-all">
              {recoveryCodes.map((code, idx) => (
                <div key={idx} className="py-1 px-2 bg-black/20 rounded border border-white/[0.03]">
                  {code}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={downloadRecoveryCodes}
                className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl text-xs font-bold text-white uppercase tracking-wider transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Download Codes (.txt)
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryCodes([]);
                  setEmail('');
                  setPassword('');
                  setOtpCode('');
                  setRecoveryCode('');
                  setChallengeToken('');
                  setMfaRequired(false);
                  setMfaSetupRequired(false);
                  window.location.reload();
                }}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-xs font-extrabold uppercase tracking-wider text-white rounded-2xl shadow-[0_0_15px_rgba(16,185,129,0.25)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98]"
              >
                I have saved these codes, proceed
              </button>
            </div>
          </GlassCard>
        </div>
      </div>
    );
  }

  const isOverlayVisible = !isAuthenticated;

  return (
    <div className="relative min-h-screen w-full flex">
      {/* Dashboard content — blurred when overlay is active */}
      <div
        className={`w-full flex-1 flex min-h-screen ${
          isOverlayVisible
            ? 'filter blur-[2px] pointer-events-none select-none opacity-75'
            : ''
        } transition-all duration-700 ease-in-out`}
      >
        {/* Wrap authenticated content in AuthProvider so Sidebar can call logout via useAuth() */}
        <AuthProvider onLogout={handleLogout}>
          {children}
        </AuthProvider>
      </div>

      {/* Login Overlay */}
      {!isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[3px] overflow-y-auto p-4 animate-fade-in">
          {/* Ambient light orbs */}
          <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] bg-accent-violet/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-accent-blue/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />

          <div className="w-full max-w-md relative z-10 animate-slide-up">
            {/* Logo header */}
            <div className="flex items-center gap-4 mb-6 px-1">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg backdrop-blur-xl relative overflow-hidden flex-shrink-0">
                <img src="/siddesh_logo.png" alt="Siddesh Logo" className="w-8 h-8 object-contain rounded-lg" />
              </div>
              <div className="text-left">
                <h1 className="text-2xl font-black tracking-tight text-white leading-none">
                  Siddesh Tech
                </h1>
                <p className="text-[9px] text-zinc-500 mt-1.5 uppercase tracking-widest font-extrabold flex items-center gap-1.5 leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                  LMS Admin Console
                </p>
              </div>
            </div>

            {/* Login Glass Card */}
            <GlassCard
              className={`bg-[#121216]/55 border border-white/5 p-8 rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] relative overflow-hidden ${
                shakeError ? 'animate-shake' : ''
              }`}
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-accent-violet via-fuchsia-500 to-accent-blue" />

              <div className="mb-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-accent-violet" />
                  {mfaRequired
                    ? mfaSetupRequired
                      ? 'Setup Authenticator MFA'
                      : 'Multi-Factor Auth'
                    : 'Sign In'}
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  {mfaRequired
                    ? mfaSetupRequired
                      ? 'Enroll this device to secure your administration console.'
                      : isRecoveryMode
                      ? 'Enter a backup recovery code.'
                      : 'Enter the 6-digit code from your authenticator app.'
                    : 'Verify credentials to access core systems.'}
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {!mfaRequired ? (
                  <>
                    {/* Email */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-zinc-500" />
                        Official Email
                      </label>
                      <input
                        type="email"
                        required
                        autoComplete="username"
                        placeholder="admin@lms.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        maxLength={254}
                        className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-2xl text-sm text-white placeholder-zinc-600 focus:outline-none transition-all"
                      />
                    </div>

                    {/* Password */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-zinc-400 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-zinc-500" />
                          Security Key
                        </label>
                        {isCapsLockOn && (
                          <span className="text-[9px] text-amber-500 flex items-center gap-1 font-bold uppercase animate-pulse">
                            <AlertTriangle className="w-3 h-3" /> Caps Lock
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          placeholder="••••••••"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          onKeyDown={handleKeyDown}
                          maxLength={200}
                          className="w-full pl-4 pr-11 py-3 bg-white/[0.03] border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-2xl text-sm text-white placeholder-zinc-600 focus:outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(p => !p)}
                          className="absolute right-3.5 top-3.5 text-zinc-500 hover:text-white transition-colors cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                ) : mfaSetupRequired ? (
                  /* MFA SETUP FLOW */
                  <div className="space-y-4 animate-fade-in text-zinc-300 text-xs">
                    <p className="leading-relaxed">
                      1. Install an authenticator application (e.g. Google Authenticator).
                    </p>
                    <p className="leading-relaxed">
                      2. Scan this QR code with your app:
                    </p>

                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 bg-white rounded-2xl shadow-lg border-4 border-white/10 mx-auto w-fit">
                        {qrCodeUrl ? (
                          <img 
                            src={qrCodeUrl}
                            alt="MFA QR Code" 
                            className="w-40 h-40" 
                          />
                        ) : (
                          <div className="w-40 h-40 flex items-center justify-center animate-pulse bg-zinc-200 rounded-xl">
                            <div className="w-6 h-6 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                      </div>
                      
                      {!copiedSecret ? (
                        <button
                          type="button"
                          onClick={copySecretToClipboard}
                          className="text-[10px] text-zinc-500 hover:text-white transition-colors"
                        >
                          Having trouble scanning? Click to copy setup key
                        </button>
                      ) : (
                        <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Setup key copied!
                        </span>
                      )}
                    </div>

                    <p className="leading-relaxed mt-2">
                      3. Enter the 6-digit confirmation code below to save:
                    </p>

                    <input
                      type="text"
                      required
                      pattern="[0-9]{6}"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                      maxLength={6}
                      className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-2xl text-center text-lg font-mono tracking-[0.4em] text-white placeholder-zinc-600 focus:outline-none transition-all"
                    />

                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setMfaRequired(false);
                          setMfaSetupRequired(false);
                          setChallengeToken('');
                          setOtpCode('');
                          setError('');
                        }}
                        className="text-[10px] text-accent-violet hover:underline cursor-pointer transition-colors"
                      >
                        Cancel setup
                      </button>
                    </div>
                  </div>
                ) : (
                  /* NORMAL MFA OTP OR RECOVERY CODE INPUT */
                  <div className="space-y-3 animate-fade-in">
                    {!isRecoveryMode ? (
                      /* Authenticator code mode */
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-400 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-zinc-500" />
                          MFA Authenticator Code
                        </label>
                        <input
                          type="text"
                          required
                          pattern="[0-9]{6}"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="000000"
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                          maxLength={6}
                          className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-2xl text-center text-lg font-mono tracking-[0.4em] text-white placeholder-zinc-600 focus:outline-none transition-all"
                        />
                      </div>
                    ) : (
                      /* Recovery code mode */
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-400 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-zinc-500" />
                          Backup Recovery Code
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="XXXX-XXXX"
                          value={recoveryCode}
                          onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
                          maxLength={15}
                          className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-2xl text-center text-sm font-mono text-white placeholder-zinc-600 focus:outline-none transition-all"
                        />
                      </div>
                    )}

                    <div className="flex justify-between items-center px-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsRecoveryMode(prev => !prev);
                          setOtpCode('');
                          setRecoveryCode('');
                          setError('');
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 hover:underline cursor-pointer transition-colors"
                      >
                        {isRecoveryMode ? 'Use authentication app' : 'Use a recovery code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMfaRequired(false);
                          setOtpCode('');
                          setRecoveryCode('');
                          setChallengeToken('');
                          setError('');
                        }}
                        className="text-[10px] text-accent-violet hover:underline cursor-pointer transition-colors"
                      >
                        Back to password
                      </button>
                    </div>
                  </div>
                )}

                {/* Rate limit messages */}
                {rateLimitMsg && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-xs flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold">{rateLimitMsg}</span>
                  </div>
                )}

                {/* Errors */}
                {error && !rateLimitMsg && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold">{error}</span>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 mt-2 bg-gradient-to-r from-accent-violet via-indigo-600 to-accent-blue text-xs font-extrabold uppercase tracking-wider text-white rounded-2xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      {mfaRequired
                        ? mfaSetupRequired
                          ? 'Verify & Enable MFA'
                          : isRecoveryMode
                          ? 'Verify Recovery Code'
                          : 'Verify Authenticator Code'
                        : 'Verify Credentials'}
                    </>
                  )}
                </button>
              </form>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}

