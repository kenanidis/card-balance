import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User
} from 'firebase/auth'
import { collection, doc, getFirestore, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore'
import type { ApprovalStatus } from './types'

export type AuthenticationMethod = 'GOOGLE' | 'EMAIL_LINK' | 'EMAIL_PASSWORD'

const PENDING_EMAIL_KEY = 'card-balance-pending-email'
const AUTH_METHOD_KEY = 'card-balance-auth-method'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

export const firebaseConfigured = Object.values(config).every(Boolean)
const app = firebaseConfigured ? initializeApp(config) : null
export const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null

function installationId(): string {
  const key = 'card-balance-web-installation-id'
  const current = localStorage.getItem(key)
  if (current) return current
  const created = crypto.randomUUID()
  localStorage.setItem(key, created)
  return created
}

function rememberMethod(method: AuthenticationMethod): void {
  localStorage.setItem(AUTH_METHOD_KEY, method)
}

export function authenticationMethod(user: User): AuthenticationMethod {
  const remembered = localStorage.getItem(AUTH_METHOD_KEY) as AuthenticationMethod | null
  if (remembered) return remembered
  return user.providerData.some(provider => provider.providerId === 'google.com') ? 'GOOGLE' : 'EMAIL_PASSWORD'
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function requestIdFor(user: User): Promise<string> {
  return sha256(`${user.uid}|gr.cardbalance.web|${installationId()}`)
}

export function observeUser(callback: (user: User | null) => void): Unsubscribe {
  if (!auth) {
    callback(null)
    return () => undefined
  }
  return onAuthStateChanged(auth, user => {
    if (user?.providerData.some(provider => provider.providerId === 'google.com')) rememberMethod('GOOGLE')
    callback(user)
  })
}

export async function loginWithGoogle(): Promise<void> {
  if (!auth) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  rememberMethod('GOOGLE')
  const provider = new GoogleAuthProvider()
  // Popup authentication avoids the third-party storage restrictions that can
  // break Firebase redirect authentication on Safari and installed iOS PWAs.
  await signInWithPopup(auth, provider)
}

export function hasPendingEmailLink(): boolean {
  return Boolean(auth && isSignInWithEmailLink(auth, window.location.href))
}

export function rememberedEmailForLink(): string {
  return localStorage.getItem(PENDING_EMAIL_KEY) || ''
}

export async function sendEmailLoginLink(email: string): Promise<void> {
  if (!auth) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  const normalized = email.trim().toLowerCase()
  await sendSignInLinkToEmail(auth, normalized, {
    url: `${window.location.origin}${window.location.pathname}`,
    handleCodeInApp: true
  })
  localStorage.setItem(PENDING_EMAIL_KEY, normalized)
}

export async function completeEmailLogin(email: string): Promise<void> {
  if (!auth || !isSignInWithEmailLink(auth, window.location.href)) throw new Error('Ο σύνδεσμος σύνδεσης δεν είναι έγκυρος.')
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Συμπληρώστε το email στο οποίο στάλθηκε ο σύνδεσμος.')
  await signInWithEmailLink(auth, normalized, window.location.href)
  rememberMethod('EMAIL_LINK')
  localStorage.removeItem(PENDING_EMAIL_KEY)
  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`)
}

export async function registerWithPassword(email: string, password: string): Promise<void> {
  if (!auth) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
  await sendEmailVerification(result.user, { url: `${window.location.origin}${window.location.pathname}` })
  await signOut(auth)
}

export async function loginWithPassword(email: string, password: string): Promise<void> {
  if (!auth) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  const result = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
  await reload(result.user)
  if (!result.user.emailVerified) {
    await signOut(auth)
    throw new Error('Το email δεν έχει επιβεβαιωθεί. Ανοίξτε το μήνυμα επιβείωσης και δοκιμάστε ξανά.')
  }
  rememberMethod('EMAIL_PASSWORD')
}

export async function resetPassword(email: string): Promise<void> {
  if (!auth) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  await sendPasswordResetEmail(auth, email.trim().toLowerCase())
}

export async function logout(): Promise<void> {
  if (auth) await signOut(auth)
}

export function friendlyAuthError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Υπάρχει ήδη λογαριασμός με αυτό το email.',
    'auth/invalid-email': 'Η διεύθυνση email δεν είναι έγκυρη.',
    'auth/invalid-credential': 'Το email ή ο κωδικός πρόσβασης δεν είναι σωστός.',
    'auth/weak-password': 'Ο κωδικός πρόσβασης πρέπει να έχει τουλάχιστον 6 χαρακτήρες.',
    'auth/too-many-requests': 'Έγιναν πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα.',
    'auth/operation-not-allowed': 'Αυτή η μέθοδος σύνδεσης δεν έχει ενεργοποιηθεί ακόμη στο Firebase.',
    'auth/popup-blocked': 'Ο browser μπλόκαρε το παράθυρο σύνδεσης. Επιτρέψτε τα αναδυόμενα παράθυρα και δοκιμάστε ξανά.',
    'auth/popup-closed-by-user': 'Η σύνδεση ακυρώθηκε πριν ολοκληρωθεί.',
    'auth/network-request-failed': 'Δεν ήταν δυνατή η επικοινωνία. Ελέγξτε τη σύνδεση στο διαδίκτυο.'
  }
  return messages[code] || (error instanceof Error ? error.message : 'Η ταυτοποίηση απέτυχε.')
}

export async function createApprovalRequest(user: User, enteredName: string): Promise<string> {
  if (!db) throw new Error('Δεν έχει ρυθμιστεί ακόμη το Firebase Web App.')
  if (!user.emailVerified) throw new Error('Απαιτείται επαληθευμένο email.')
  const requestId = await requestIdFor(user)
  const userAgentData = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData
  const browser = userAgentData?.brands?.map(value => value.brand).join(', ') || navigator.userAgent.slice(0, 180)
  await setDoc(doc(collection(db, 'installationRequests'), requestId), {
    appName: 'Card Balance Web',
    packageName: 'gr.cardbalance.web',
    versionName: '0.3.0',
    versionCode: 3,
    userEnteredName: enteredName.trim(),
    email: user.email,
    normalizedEmail: user.email?.trim().toLowerCase(),
    uid: user.uid,
    installationId: installationId(),
    manufacturer: 'Web',
    model: browser,
    commercialName: navigator.platform || 'Browser',
    androidVersion: 'Web',
    sdkLevel: 0,
    clientPlatform: 'WEB',
    authProvider: authenticationMethod(user),
    requestedAt: serverTimestamp(),
    status: 'PENDING',
    approvedAt: null,
    rejectedAt: null,
    revokedAt: null,
    lastAdminActionAt: null,
    lastAdminUid: null,
    lastAuditId: null,
    previousRequestId: null,
    previousDevice: null,
    indicators: [],
    indicatorsSource: 'CLIENT_HEURISTIC'
  })
  return requestId
}

export async function observeApproval(user: User, callback: (status: ApprovalStatus) => void): Promise<Unsubscribe> {
  if (!db) return () => undefined
  const requestId = await requestIdFor(user)
  return onSnapshot(doc(db, 'installationRequests', requestId), snapshot => {
    callback(snapshot.exists() ? snapshot.data().status as ApprovalStatus : 'NONE')
  }, () => callback('NONE'))
}

export async function idToken(): Promise<string> {
  if (!auth?.currentUser) throw new Error('Απαιτείται σύνδεση.')
  return auth.currentUser.getIdToken()
}
