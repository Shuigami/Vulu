// French messages for Better Auth error codes. Kept in one place to ease i18n later.
const messages: Record<string, string> = {
	NOT_INVITED: 'Vulu est en bêta sur invitation : cette adresse e-mail n’a pas encore été invitée.',
	INVALID_USERNAME: 'Le pseudo doit faire 3 à 30 caractères : lettres, chiffres ou tiret bas (_).',
	USERNAME_TAKEN: 'Ce pseudo est déjà pris.',
	USER_ALREADY_EXISTS: 'Un compte existe déjà avec cette adresse e-mail.',
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Un compte existe déjà avec cette adresse e-mail.',
	INVALID_EMAIL: 'Adresse e-mail invalide.',
	INVALID_EMAIL_OR_PASSWORD: 'E-mail ou mot de passe incorrect.',
	PASSWORD_TOO_SHORT: 'Le mot de passe doit faire au moins 8 caractères.',
	PASSWORD_TOO_LONG: 'Le mot de passe est trop long.',
	TOO_MANY_REQUESTS: 'Trop de tentatives, réessaie dans un moment.'
};

export function authErrorMessage(code: string | null | undefined): string {
	return (code && messages[code.toUpperCase()]) || 'Une erreur est survenue, réessaie.';
}
