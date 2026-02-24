import crypto from "crypto";

export function generate6DigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(email: string, code: string) {
  const secret = process.env.OTP_SECRET!;
  return crypto
    .createHmac("sha256", secret)
    .update(`${email}:${code}`)
    .digest("hex");
}