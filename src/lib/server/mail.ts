// Outgoing e-mail over SMTP. Without SMTP_URL (development), messages are printed to the console.
import { createTransport } from 'nodemailer';

export type Mail = { to: string; subject: string; text: string };
export type SendMail = (mail: Mail) => Promise<void>;

/** `smtpUrl` like smtps://user:password@smtp.example.com:465; `from` like "Vulu <noreply@example.com>". */
export function createMailer(smtpUrl?: string, from = 'Vulu <noreply@localhost>'): SendMail {
	if (!smtpUrl) {
		return async (mail) => {
			console.info(`[mail] (no SMTP_URL) to ${mail.to}: ${mail.subject}\n${mail.text}`);
		};
	}
	const transport = createTransport(smtpUrl);
	return async (mail) => {
		await transport.sendMail({ from, ...mail });
	};
}

export function resetPasswordMail(to: string, name: string, url: string): Mail {
	return {
		to,
		subject: 'Réinitialiser ton mot de passe Vulu',
		text: [
			`Bonjour ${name},`,
			'',
			'Quelqu’un (sans doute toi) a demandé à réinitialiser ton mot de passe Vulu.',
			'Pour en choisir un nouveau, ouvre ce lien dans l’heure :',
			'',
			url,
			'',
			'Si ce n’est pas toi, ignore cet e-mail : ton mot de passe ne change pas.'
		].join('\n')
	};
}
