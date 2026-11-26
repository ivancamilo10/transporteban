export function getPhoneLoginEmail(identifier: string) {
  const trimmed = identifier.trim();
  if (trimmed.includes("@") || !/^[+\d\s().-]+$/.test(trimmed)) return null;

  const rawDigits = trimmed.replace(/\D/g, "");
  const digits = rawDigits.startsWith("57") && rawDigits.length === 12
    ? rawDigits.slice(2)
    : rawDigits;
  if (digits.length < 7 || digits.length > 15) return null;

  return `${digits}@transporteban.test`;
}
