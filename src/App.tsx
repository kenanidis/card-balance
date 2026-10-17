import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { Barcode } from './barcode'
import { fetchBalance } from './balance'
import {
  completeEmailLogin,
  createApprovalRequest,
  firebaseConfigured,
  friendlyAuthError,
  hasPendingEmailLink,
  loginWithGoogle,
  loginWithPassword,
  logout,
  observeApproval,
  observeUser,
  registerWithPassword,
  rememberedEmailForLink,
  resetPassword,
  sendEmailLoginLink
} from './firebase'
import { clearLocalData, exportBackup, importBackup, loadState, saveState } from './storage'
import { EMPTY_STATE, type ApprovalStatus, type LocalState } from './types'

const euro = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short' })
const appIcon = `${import.meta.env.BASE_URL}icon.svg`

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function runsAsInstalledApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function App() {
  const [state, setState] = useState<LocalState>(structuredClone(EMPTY_STATE))
  const [loaded, setLoaded] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [approval, setApproval] = useState<ApprovalStatus>('NONE')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'home' | 'history' | 'settings'>('home')
  const [showBarcode, setShowBarcode] = useState(false)
  const [authView, setAuthView] = useState<'choices' | 'email-link' | 'password'>('choices')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLinkCompletion, setEmailLinkCompletion] = useState(false)
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isIos = /iPad|iPhone|iPod/i.test(navigator.userAgent)
  const isAndroid = /Android/i.test(navigator.userAgent)

  useEffect(() => {
    void loadState().then(value => setState(value)).catch(error => setMessage(String(error))).finally(() => setLoaded(true))
    return observeUser(setUser)
  }, [])

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const installed = () => {
      setInstallPrompt(null)
      setShowInstallGuide(false)
    }
    window.addEventListener('beforeinstallprompt', capturePrompt)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  useEffect(() => {
    if (!firebaseConfigured || !hasPendingEmailLink()) return
    const rememberedEmail = rememberedEmailForLink()
    setAuthView('email-link')
    setEmail(rememberedEmail)
    setEmailLinkCompletion(true)
    if (rememberedEmail) {
      setBusy(true)
      void completeEmailLogin(rememberedEmail)
        .catch(error => setMessage(friendlyAuthError(error)))
        .finally(() => setBusy(false))
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    void saveState(state).catch(error => setMessage(String(error)))
  }, [state, loaded])

  useEffect(() => {
    let unsubscribe: () => void = () => undefined
    if (user) void observeApproval(user, setApproval).then(value => { unsubscribe = value })
    else setApproval('NONE')
    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && approval === 'APPROVED' && state.card.cardNumber && navigator.onLine) void refreshBalance(false)
    }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  })

  const cardWarnings = useMemo(() => ({
    card: state.card.cardNumber && state.card.cardNumber.length !== 19 ? 'Ελέγξτε τον αριθμό διατακτικής (αναμένονται 19 ψηφία).' : '',
    extra: state.card.extraCode && state.card.extraCode.length !== 6 ? 'Ελέγξτε τον κωδικό (αναμένονται 6 ψηφία).' : '',
    points: state.card.pointsNumber && state.card.pointsNumber.length !== 13 ? 'Ελέγξτε τον αριθμό κάρτας πόντων (αναμένονται 13 ψηφία).' : ''
  }), [state.card])

  function updateCard(field: keyof LocalState['card'], value: string) {
    setState(current => ({ ...current, card: { ...current.card, [field]: value.replace(/\D/g, '') } }))
  }

  async function refreshBalance(manual: boolean) {
    const now = Date.now()
    const recent = state.lastManualRefreshes.filter(value => now - value < 60_000)
    if (manual && recent.length >= 2) {
      const seconds = Math.ceil((60_000 - (now - recent[0])) / 1000)
      setMessage(`Προσωρινός περιορισμός ανανέωσης. Απομένουν ${seconds} δευτερόλεπτα.`)
      window.setTimeout(() => void refreshBalance(false), seconds * 1000)
      return
    }
    if (!state.card.cardNumber || state.card.extraCode.length !== 6) {
      setMessage('Συμπληρώστε αριθμό διατακτικής και εξαψήφιο κωδικό.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await fetchBalance(state.card.cardNumber, state.card.extraCode)
      setState(current => {
        const previous = current.balance
        const history = previous && previous.cents !== result.cents
          ? [{ id: crypto.randomUUID(), previousCents: previous.cents, newCents: result.cents, changedAt: now }, ...current.history].slice(0, 100)
          : current.history
        return {
          ...current,
          balance: { ...result, checkedAt: now },
          history,
          lastManualRefreshes: manual ? [...recent, now] : recent
        }
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitApproval() {
    if (!user || !name.trim()) return setMessage('Συμπληρώστε το όνομά σας.')
    setBusy(true)
    try {
      await createApprovalRequest(user, name)
      setMessage('Το αίτημα πρόσβασης στάλθηκε. Παρακαλώ δοκιμάστε αργότερα εφόσον έχει εγκριθεί.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  function beginApprovalRequest() {
    if (!user || !name.trim()) return setMessage('Συμπληρώστε το όνομά σας.')
    if (runsAsInstalledApp()) void submitApproval()
    else setShowInstallGuide(true)
  }

  async function installAndSubmit() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') {
      setShowInstallGuide(false)
      await submitApproval()
    }
  }

  async function performAuth(action: () => Promise<void>, successMessage = '') {
    setBusy(true)
    setMessage('')
    try {
      await action()
      if (successMessage) setMessage(successMessage)
    } catch (error) {
      setMessage(friendlyAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <main className="center"><div className="spinner" aria-label="Φόρτωση" /></main>

  if (!state.termsAccepted) return (
    <main className="center"><section className="panel narrow">
      <img src={appIcon} className="app-icon" alt="" />
      <h1>Card Balance</h1>
      <h2>Όροι χρήσης και απόρρητο</h2>
      <p>Η εφαρμογή είναι ανεξάρτητη και μη επίσημη. Τα στοιχεία της κάρτας αποθηκεύονται μόνο σε αυτήν τη συσκευή. Η ζωντανή ενημέρωση απαιτεί σύνδεση στο διαδίκτυο.</p>
      <button onClick={() => setState(current => ({ ...current, termsAccepted: true }))}>Αποδοχή και συνέχεια</button>
    </section></main>
  )

  if (!firebaseConfigured || !user || approval !== 'APPROVED') return (
    <main className="center"><section className="panel narrow">
      <img src={appIcon} className="app-icon" alt="" />
      <h1>Card Balance</h1>
      {!firebaseConfigured && <div className="notice warning">Απαιτείται ρύθμιση του Firebase Web App στο αρχείο περιβάλλοντος.</div>}
      {!user ? <div className="auth-area">
        {authView === 'choices' && <>
          <button disabled={!firebaseConfigured || busy} onClick={() => void performAuth(loginWithGoogle)}>Σύνδεση με Google</button>
          <div className="auth-divider"><span>ή</span></div>
          <button className="secondary" disabled={!firebaseConfigured || busy} onClick={() => setAuthView('email-link')}>Σύνδεση με email</button>
          <button className="text-button" disabled={!firebaseConfigured || busy} onClick={() => setAuthView('password')}>Email και κωδικός πρόσβασης</button>
        </>}
        {authView === 'email-link' && <>
          <h3>{emailLinkCompletion ? 'Ολοκλήρωση σύνδεσης' : 'Σύνδεση χωρίς κωδικό'}</h3>
          <p className="muted">{emailLinkCompletion ? 'Συμπληρώστε το ίδιο email στο οποίο στάλθηκε ο σύνδεσμος.' : 'Θα σας στείλουμε έναν ασφαλή σύνδεσμο επιβεβαίωσης.'}</p>
          <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          {emailLinkCompletion
            ? <button disabled={busy || !email.trim()} onClick={() => void performAuth(() => completeEmailLogin(email))}>Ολοκλήρωση σύνδεσης</button>
            : <button disabled={busy || !email.trim()} onClick={() => void performAuth(() => sendEmailLoginLink(email), 'Ο σύνδεσμος σύνδεσης στάλθηκε στο email σας.')}>Αποστολή συνδέσμου</button>}
          {!emailLinkCompletion && <button className="text-button" onClick={() => setAuthView('password')}>Χρήση κωδικού πρόσβασης</button>}
          <button className="text-button" onClick={() => { setAuthView('choices'); setEmailLinkCompletion(false) }}>Πίσω</button>
        </>}
        {authView === 'password' && <>
          <h3>Email και κωδικός πρόσβασης</h3>
          <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Κωδικός πρόσβασης<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <button disabled={busy || !email.trim() || !password} onClick={() => void performAuth(() => loginWithPassword(email, password))}>Σύνδεση</button>
          <button className="secondary" disabled={busy || !email.trim() || password.length < 6} onClick={() => void performAuth(() => registerWithPassword(email, password), 'Ο λογαριασμός δημιουργήθηκε. Ελέγξτε το email σας για επιβεβαίωση πριν συνδεθείτε.')}>Δημιουργία λογαριασμού</button>
          <button className="text-button" disabled={busy || !email.trim()} onClick={() => void performAuth(() => resetPassword(email), 'Στάλθηκε email επαναφοράς κωδικού.')}>Ξέχασα τον κωδικό</button>
          <button className="text-button" onClick={() => setAuthView('choices')}>Πίσω</button>
        </>}
      </div> : <>
        <p className="account">{user.email}</p>
        {approval === 'NONE' && <>
          <label>Ονοματεπώνυμο<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
          <button disabled={busy} onClick={beginApprovalRequest}>Αποστολή αιτήματος</button>
        </>}
        {approval !== 'NONE' && <div className={`notice status-${approval.toLowerCase()}`}>Κατάσταση: {approval}</div>}
        <button className="secondary" onClick={() => void logout()}>Αποσύνδεση</button>
      </>}
      {message && <div className="notice warning">{message}</div>}
      {showInstallGuide && <div className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <section>
          <h2 id="install-title">Εγκατάσταση εφαρμογής</h2>
          <p>Για ευκολότερη και πιο αξιόπιστη χρήση, συνιστάται να εγκαταστήσετε το Card Balance στη συσκευή σας πριν στείλετε το αίτημα πρόσβασης.</p>
          {isIos ? <div className="install-steps">
            <strong>iPhone ή iPad — Safari</strong>
            <ol><li>Πατήστε το κουμπί <b>Κοινοποίηση</b>.</li><li>Επιλέξτε <b>Προσθήκη στην οθόνη Αφετηρίας</b>.</li><li>Πατήστε <b>Προσθήκη</b>.</li></ol>
          </div> : <div className="install-steps">
            <strong>{isAndroid ? 'Android — Chrome' : 'Υπολογιστής ή άλλος browser'}</strong>
            <p>{installPrompt ? 'Πατήστε «Εγκατάσταση τώρα» και επιβεβαιώστε την εγκατάσταση.' : 'Ανοίξτε το μενού του browser και επιλέξτε «Εγκατάσταση εφαρμογής» ή «Προσθήκη στην αρχική οθόνη».'}</p>
          </div>}
          <div className="install-actions">
            {installPrompt && <button disabled={busy} onClick={() => void installAndSubmit()}>Εγκατάσταση τώρα</button>}
            <button className="secondary" disabled={busy} onClick={() => { setShowInstallGuide(false); void submitApproval() }}>Συνέχεια χωρίς εγκατάσταση</button>
            <button className="text-button" disabled={busy} onClick={() => setShowInstallGuide(false)}>Άκυρο</button>
          </div>
        </section>
      </div>}
    </section></main>
  )

  return <div className="app-shell">
    <header><img src={appIcon} alt="" /><div><strong>Card Balance</strong><small>{navigator.onLine ? 'Online' : 'Offline'}</small></div><button className="icon-button" aria-label="Αποσύνδεση" onClick={() => void logout()}>↪</button></header>
    <main>
      {tab === 'home' && <>
        <section className="balance-card">
          <span>Διαθέσιμο υπόλοιπο</span>
          <strong>{state.balance?.formatted || '—'}</strong>
          <small>{state.balance ? `Τελευταία ενημέρωση υπολοίπου: ${dateTime.format(state.balance.checkedAt)}` : 'Δεν έχει γίνει ακόμη ενημέρωση'}</small>
          <button disabled={busy || !navigator.onLine} onClick={() => void refreshBalance(true)}>{busy ? 'Έλεγχος…' : 'Ανανέωση'}</button>
        </section>
        <section className="panel form-panel">
          <h2>Στοιχεία κάρτας</h2>
          <label>Αριθμός διατακτικής<input inputMode="numeric" value={state.card.cardNumber} onChange={event => updateCard('cardNumber', event.target.value)} /></label>
          {cardWarnings.card && <small className="field-warning">{cardWarnings.card}</small>}
          <label>Κωδικός<input inputMode="numeric" value={state.card.extraCode} onChange={event => updateCard('extraCode', event.target.value)} /></label>
          {cardWarnings.extra && <small className="field-warning">{cardWarnings.extra}</small>}
          <label>Κάρτα συλλογής πόντων (προαιρετικό)<input inputMode="numeric" value={state.card.pointsNumber} onChange={event => updateCard('pointsNumber', event.target.value)} /></label>
          {cardWarnings.points && <small className="field-warning">{cardWarnings.points}</small>}
          {state.card.pointsNumber && <button className="points-card" onClick={() => setShowBarcode(true)} onPointerDown={event => { if (event.pointerType === 'touch') window.setTimeout(() => setShowBarcode(true), 500) }}>
            <span>Κάρτα συλλογής πόντων</span><Barcode value={state.card.pointsNumber} /><small>Πατήστε για μεγέθυνση</small>
          </button>}
        </section>
      </>}
      {tab === 'history' && <section className="panel"><h2>Ιστορικό</h2>{state.history.length === 0 ? <p className="muted">Δεν υπάρχουν μεταβολές.</p> : state.history.map(entry => {
        const difference = entry.newCents - entry.previousCents
        return <article className="history-row" key={entry.id}><div><strong className={difference >= 0 ? 'positive' : 'negative'}>{difference >= 0 ? '+' : ''}{euro.format(difference / 100)}</strong><small>{dateTime.format(entry.changedAt)}</small></div><span>{euro.format(entry.previousCents / 100)} → {euro.format(entry.newCents / 100)}</span></article>
      })}</section>}
      {tab === 'settings' && <section className="panel settings"><h2>Ρυθμίσεις</h2>
        <button className="backup-create" onClick={() => exportBackup(state)}>Δημιουργία backup ιστορικού</button>
        <button onClick={() => fileRef.current?.click()}>Επαναφορά backup</button>
        <input ref={fileRef} hidden type="file" accept="application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void importBackup(file).then(history => setState(current => ({ ...current, history }))).catch(error => setMessage(String(error))) }} />
        <button className="secondary" onClick={() => setState(current => ({ ...current, termsAccepted: false }))}>Προβολή όρων</button>
        <button className="danger" onClick={() => { if (window.confirm('Να διαγραφούν όλα τα τοπικά δεδομένα;')) void clearLocalData().then(() => location.reload()) }}>Διαγραφή τοπικών δεδομένων</button>
        <p className="muted">Web έκδοση 0.3.4</p>
      </section>}
      {message && <div className="toast" role="status" onClick={() => setMessage('')}>{message}</div>}
    </main>
    <nav><button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>Αρχική</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Ιστορικό</button><button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Ρυθμίσεις</button></nav>
    {showBarcode && <div className="barcode-modal" role="dialog" aria-modal="true" onClick={() => setShowBarcode(false)}><div><Barcode value={state.card.pointsNumber} /><p>{state.card.pointsNumber}</p><button>Κλείσιμο</button></div></div>}
  </div>
}

export default App
