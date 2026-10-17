import { idToken, requestIdFor, auth } from './firebase'

export interface BalanceResponse {
  cents: number
  formatted: string
}

export async function fetchBalance(cardNumber: string, extraCode: string): Promise<BalanceResponse> {
  if (!auth?.currentUser) throw new Error('Απαιτείται σύνδεση.')
  const endpoint = import.meta.env.VITE_BALANCE_API_PATH
  if (!endpoint) throw new Error('Η υπηρεσία ελέγχου υπολοίπου δεν έχει ρυθμιστεί.')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idToken()}`
    },
    cache: 'no-store',
    credentials: 'same-origin',
    body: JSON.stringify({
      requestId: await requestIdFor(auth.currentUser),
      cardNumber,
      extraCode
    })
  })
  const body = await response.json() as { cents?: number; formatted?: string; error?: string }
  if (!response.ok) throw new Error(body.error || 'Ο έλεγχος υπολοίπου απέτυχε.')
  if (typeof body.cents !== 'number' || typeof body.formatted !== 'string') throw new Error('Μη αναμενόμενη απάντηση υπηρεσίας.')
  return { cents: body.cents, formatted: body.formatted }
}
