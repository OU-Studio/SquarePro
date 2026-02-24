import nodemailer from "nodemailer";

export function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP env vars missing (SMTP_HOST/SMTP_USER/SMTP_PASS).");
  }

  return nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },

  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,

  logger: true,
  debug: true,
});
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function sendOtpEmail(to: string, code: string) {
  const from = process.env.SMTP_FROM || "SquarePro <no-reply@squarepro.co.uk>";
  const transporter = getMailer();

  try {
    console.log("[mailer] verify start");
    await transporter.verify();
    console.log("[mailer] verify ok");

    console.log("[mailer] send start");
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Your SquarePro verification code",
      text: `Your SquarePro code is: ${code}\n\nIt expires in 10 minutes.`,
    });
    console.log("[mailer] send ok", info?.messageId || info);
  } catch (e: any) {
    console.error("[mailer] SEND FAILED", e?.message || e, e?.stack || "");
    throw e;
  }
}

export async function sendLicenseKeyEmail(params: {
  to: string;
  licenseKey: string;
}) {
  const { to, licenseKey } = params;

  const from = process.env.SMTP_FROM || "SquarePro <no-reply@squarepro.co.uk>";
  const transporter = getMailer();

  const snippet = `<script src="https://cdn.squarepro.co.uk/squarepro.min.js" data-squarepro-key="${licenseKey}"></script>`;

  await transporter.sendMail({
    from,
    to,
    subject: "Your SquarePro license key",
    text:
      `Here’s your SquarePro license key:\n\n` +
      `${licenseKey}\n\n` +
      `Install (Squarespace → Settings → Advanced → Code Injection → HEADER):\n\n` +
      `${snippet}\n\n` +
      `Activation:\n` +
      `1) Load once on yoursite.squarespace.com (preview domain)\n` +
      `2) Load once on your live domain\n` +
      `Your license will bind to those two domains.\n`,
  });
}