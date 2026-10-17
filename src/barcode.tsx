interface BarcodeProps {
  value: string
}

function checksum(value: string): number {
  const sum = value.split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0)
  return (10 - sum % 10) % 10
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function bitsFor(raw: string): string {
  const twelve = raw.slice(0, 12).padStart(12, '0')
  const full = `${twelve}${checksum(twelve)}`
  const first = Number(full[0])
  let bits = '101'
  for (let index = 1; index <= 6; index += 1) {
    const digit = Number(full[index])
    bits += parity[first][index - 1] === 'L' ? L[digit] : G[digit]
  }
  bits += '01010'
  for (let index = 7; index <= 12; index += 1) bits += R[Number(full[index])]
  return `${bits}101`
}

export function Barcode({ value }: BarcodeProps) {
  const normalized = value.replace(/\D/g, '')
  if (normalized.length !== 13) return <p className="hint">Ο αριθμός κάρτας πόντων πρέπει να έχει 13 ψηφία.</p>
  const bits = bitsFor(normalized)
  return (
    <svg className="barcode" viewBox={`0 0 ${bits.length} 54`} role="img" aria-label={`Barcode ${normalized}`}>
      <rect width={bits.length} height="54" fill="#fff" />
      {bits.split('').map((bit, index) => bit === '1' ? <rect key={index} x={index} y="2" width="1" height="42" fill="#111" /> : null)}
      <text x={bits.length / 2} y="52" textAnchor="middle" fontSize="7" letterSpacing="1.5">{normalized}</text>
    </svg>
  )
}
