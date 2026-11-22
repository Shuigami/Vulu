import { describe, expect, it } from 'vitest';
import { requireUser } from './guard';

const loginFor = (href: string) => {
	try {
		requireUser({} as App.Locals, new URL(href, 'http://x'));
	} catch (r) {
		return (r as { location: string }).location;
	}
};

describe('requireUser', () => {
	it('sends a visitor to the login page, back to the page without the action', () => {
		expect(loginFor('/media/3?/add')).toBe('/login?redirectTo=%2Fmedia%2F3');
		expect(loginFor('/search?q=loki&/import')).toBe('/login?redirectTo=%2Fsearch%3Fq%3Dloki');
		expect(loginFor('/library?type=book')).toBe('/login?redirectTo=%2Flibrary%3Ftype%3Dbook');
	});
});
