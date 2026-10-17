# Card Balance Web / PWA

Ανεξάρτητη Web/PWA έκδοση. Δεν αποτελεί Android module και δεν αλλάζει το `../app`.

## Τοπική εκτέλεση

1. Αντιγράψτε το `.env.example` σε `.env`.
2. Καταχωρίστε Web App **στο υπάρχον Firebase project** και συμπληρώστε μόνο το δημόσιο Web configuration.
3. Στο Firebase Authentication ενεργοποιήστε τους providers **Google** και **Email/Password**.
4. Ενεργοποιήστε το passwordless **Email link** και προσθέστε το domain στα Authorized domains.
5. Εκτελέστε `pnpm install --frozen-lockfile` και `pnpm dev`.

Μην αντιγράψετε service-account keys, Android signing δεδομένα ή το approval webhook στο `.env`.

Η εφαρμογή δεν υποστηρίζει ανώνυμη σύνδεση ή Sign in with Apple. Τα αιτήματα έγκρισης
καταγράφουν μόνο τη μέθοδο `GOOGLE`, `EMAIL_LINK` ή `EMAIL_PASSWORD`. Οι δύο μέθοδοι
email απαιτούν επαληθευμένη διεύθυνση πριν επιτραπεί η αποστολή αιτήματος.

## GitHub Pages

Το workflow `.github/workflows/deploy.yml` κάνει build από τον πηγαίο κώδικα και δημοσιεύει το `dist`.
Απαιτούνται οι παρακάτω GitHub Environment variables στο environment `github-pages`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_BALANCE_API_PATH`

Οι τιμές `VITE_FIREBASE_*` είναι Firebase client configuration και ενσωματώνονται στο browser bundle. Δεν πρέπει να
τοποθετηθούν στο repository service-account credentials, Admin SDK keys ή Cloudflare tokens.

## Cloudflare balance API

- Function variable: `FIREBASE_PROJECT_ID`
- Function variable: `ALLOWED_ORIGIN=https://kenanidis.github.io`
- Προαιρετική μεταβλητή: `BALANCE_UPSTREAM_URL`
- Συνιστάται Cloudflare Rate Limiting binding: `BALANCE_RATE_LIMITER`

Η `/api/balance` επαληθεύει Firebase ID token και εγκεκριμένο Web installation πριν προωθήσει το αίτημα. Δεν καταγράφει και δεν αποθηκεύει στοιχεία κάρτας.

Το endpoint επιτρέπει CORS μόνο από το GitHub Pages origin, επαληθεύει Firebase ID token και εγκεκριμένο
Web installation, και υποστηρίζει server-side rate limiting ανά Firebase UID.

Οι Firestore rules δεν δημοσιεύονται από το GitHub Pages workflow. Η παραγωγική τους ανάπτυξη γίνεται ξεχωριστά και μόνο με ρητή έγκριση.

## Περιορισμοί

- Δεν υπάρχει Web ισοδύναμο του Android widget.
- Οι ακριβείς προγραμματισμένες ενημερώσεις δεν λειτουργούν αξιόπιστα όταν η PWA είναι κλειστή.
- Το ιστορικό μπορεί να εξαχθεί/εισαχθεί ως JSON. Η αυτόματη εγγραφή σε φάκελο δεν είναι φορητή σε Safari/iOS.
