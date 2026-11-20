/* Card-number guard for free text a client types (moved from the removed portal quote rules, #245). Pure. */

function luhn(d: string): boolean {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
/** A 13–19 digit run (spaces/dashes allowed between digits) that passes Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  // Digit groups separated by a single space or dash form one run; a card is
  // any contiguous span of WHOLE groups totalling 13–19 digits that passes Luhn.
  // Checking whole groups (not every sliding window) catches "PO 12345 4111 1111 1111 1111"
  // without flagging long tracking numbers by accident.
  for (const run of text.matchAll(/\d+(?:[ -]\d+)*/g)) {
    const groups = run[0].split(/[ -]/);
    for (let i = 0; i < groups.length; i++) {
      let digits = "";
      for (let j = i; j < groups.length; j++) {
        digits += groups[j];
        if (digits.length > 19) break;
        if (digits.length >= 13 && luhn(digits)) return true;
      }
    }
  }
  return false;
}
