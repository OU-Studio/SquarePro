const RESEND_URL = "https://api.resend.com/emails";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function sendResendEmail(params: {
  to: string;
  subject: string;
  text: string;
}) {
  const apiKey = mustEnv("RESEND_API_KEY");
  const from = process.env.SMTP_FROM || "SquarePro <no-reply@squarepro.co.uk>";

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `Resend API failed (${res.status})`;
    throw new Error(msg);
  }

  return data; // contains id
}

export async function sendOtpEmail(to: string, code: string) {
  await sendResendEmail({
    to,
    subject: "Your SquarePro verification code",
    text: `Your SquarePro code is: ${code}\n\nIt expires in 10 minutes.`,
  });
}

export async function sendLicenseKeyEmail(to: string, licenseKey: string) {
  const snippet = `<script src="https://cdn.squarepro.co.uk/squarepro.min.js" data-squarepro-key="${licenseKey}"></script>`;
  await sendResendEmail({
    to,
    subject: "Your SquarePro verification code",
    text:  `Here’s your SquarePro license key:\n\n` +
      `${licenseKey}\n\n` +
      `Install (Squarespace → Settings → Advanced → Code Injection → HEADER):\n\n` +
      `${snippet}\n\n` +
      `Activation:\n` +
      `1) Load once on yoursite.squarespace.com (preview domain)\n` +
      `2) Load once on your live domain\n` +
      `Your license will bind to those two domains.\n`,
  });
}