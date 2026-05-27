import { env } from '$env/dynamic/private';

const FROM_FALLBACK = 'onboarding@resend.dev';

interface SendArgs {
	to: string;
	subject: string;
	text: string;
	html: string;
}

interface EmailSendResult {
	ok: boolean;
	delivered: boolean;
	error?: string;
}

/**
 * Send a transactional email via Resend. Returns `ok: true` whether or
 * not the message was actually delivered — callers should never expose
 * the delivery result to the requester (it would let attackers probe
 * for valid emails). `delivered` reflects whether Resend accepted the
 * call.
 *
 * In dev (no RESEND_API_KEY) the message is logged to stdout instead.
 */
export async function sendEmail(args: SendArgs): Promise<EmailSendResult> {
	const apiKey = env.RESEND_API_KEY;
	const from = env.MEMORIAM_EMAIL_FROM || FROM_FALLBACK;

	if (!apiKey) {
		console.log(`[email:dev] To: ${args.to}\n  From: ${from}\n  Subject: ${args.subject}\n  ${args.text}`);
		return { ok: true, delivered: false };
	}

	try {
		const { Resend } = await import('resend');
		const resend = new Resend(apiKey);
		const { error } = await resend.emails.send({
			from,
			to: args.to,
			subject: args.subject,
			text: args.text,
			html: args.html
		});
		if (error) {
			console.error('[email] Resend rejected the message:', error);
			return { ok: true, delivered: false, error: error.message ?? 'unknown' };
		}
		return { ok: true, delivered: true };
	} catch (err) {
		console.error('[email] Resend call threw:', err);
		return { ok: true, delivered: false, error: err instanceof Error ? err.message : 'unknown' };
	}
}

export async function sendMagicLink(email: string, link: string): Promise<EmailSendResult> {
	const product = env.MEMORIAM_PRODUCT_NAME || 'Memoriam';
	const subject = `Sign in to ${product}`;
	const text = `Click this link to sign in to ${product}:\n\n${link}\n\nIf you didn't request this, you can ignore this email. The link expires in 15 minutes.`;
	const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; color: #111; padding: 24px;">
<p>Click the link below to sign in to <strong>${product}</strong>:</p>
<p><a href="${link}" style="display: inline-block; padding: 12px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Sign in</a></p>
<p style="color: #555; font-size: 14px;">Or paste this URL into your browser: <br><span style="color: #888; word-break: break-all;">${link}</span></p>
<p style="color: #888; font-size: 13px;">If you didn't request this, you can ignore this email. The link expires in 15 minutes.</p>
</body></html>`;

	return sendEmail({ to: email, subject, text, html });
}

export async function sendInvite(
	email: string,
	link: string,
	siteName: string | null,
	inviterEmail: string | null
): Promise<EmailSendResult> {
	const product = env.MEMORIAM_PRODUCT_NAME || 'Memoriam';
	const siteLabel = siteName || 'a memorial';
	const fromLabel = inviterEmail ? ` from ${inviterEmail}` : '';
	const subject = `You're invited to ${siteLabel}`;
	const text = `You have an invitation${fromLabel} to join "${siteLabel}" on ${product}:\n\n${link}\n\nThe link expires in 14 days. If you didn't expect this, you can ignore this email.`;
	const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; color: #111; padding: 24px;">
<p>You have an invitation${fromLabel} to join <strong>${siteLabel}</strong> on ${product}.</p>
<p><a href="${link}" style="display: inline-block; padding: 12px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Accept invitation</a></p>
<p style="color: #555; font-size: 14px;">Or paste this URL into your browser: <br><span style="color: #888; word-break: break-all;">${link}</span></p>
<p style="color: #888; font-size: 13px;">The link expires in 14 days. If you didn't expect this, you can ignore this email.</p>
</body></html>`;

	return sendEmail({ to: email, subject, text, html });
}
