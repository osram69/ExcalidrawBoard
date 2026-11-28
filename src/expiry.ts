/**
 * Quando il collegamento si chiude, bisogna tornare al login? Sì se il server lo dice (codice 4001) o se l'accesso è comunque scaduto:
 * dopo uno standby o una caduta di rete il browser vede il codice 1006 e non il 4001, e riprovare con un accesso scaduto non finirebbe mai.
 */
export function shouldReturnToLogin(closeCode: number, exp: number, now: number): boolean {
  return closeCode === 4001 || closeCode === 4003 || exp <= now; // 4003: l'aula è stata eliminata
}
