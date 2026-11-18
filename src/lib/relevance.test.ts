import { describe, expect, it } from 'vitest';
import { byRelevance, relevance } from './relevance';

describe('relevance', () => {
	it('ranks exact, prefix, whole word, then other matches', () => {
		expect(relevance('Frieren', 'frieren')).toBe(3);
		expect(relevance('frieren', 'Frieren: Beyond Journey’s End')).toBe(2);
		expect(relevance('frieren', 'Kleine Frieren auch im Sommer')).toBe(1);
		expect(relevance('frier', 'Frieren')).toBe(0);
		expect(relevance('amelie', 'Le Fabuleux Destin d’Amélie Poulain')).toBe(1);
	});

	it('sorts by relevance and keeps the provider order on ties', () => {
		const items = ['Kleine Frieren auch im Sommer', 'Frieren 2', 'Sousou no Frieren', 'Frieren'];
		expect(
			byRelevance(
				'frieren',
				items.map((title) => ({ title }))
			).map((i) => i.title)
		).toEqual(['Frieren', 'Frieren 2', 'Kleine Frieren auch im Sommer', 'Sousou no Frieren']);
	});
});
