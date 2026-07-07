import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
	model: 'gemini-flash-latest',
	generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
});

export async function detectLanguage(text) {
	// simple fast heuristic for English: only ASCII standard characters (32 to 126 range)
	const isPureAscii = /^[\u0000-\u007F]*$/.test(text);
	if (isPureAscii) {
		return 'en';
	}

	const prompt = `What language is this text? Reply with ONLY the ISO 639-1 code (e.g. "en", "es", "hi"). No explanation.\n\nText: "${text}"`;

	try {
		const result = await model.generateContent(prompt);
		const code = result.response.text().trim().toLowerCase().replace(/"/g, '');
		return /^[a-z]{2}$/.test(code) ? code : 'en';
	} catch (err) {
		console.error('Language detection failed:', err.message);
		return 'en';
	}
}

export async function translateText(text, from, to) {
	if (from === to) return text;

	const translationModel = genAI.getGenerativeModel({
		model: 'gemini-flash-latest',
		generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
	});

	try {
		const result = await translationModel.generateContent(
			`Translate from ${from} to ${to}. Return ONLY the translation.\n\nText: "${text}"`
		);
		return result.response.text().trim();
	} catch (err) {
		console.error('Translation failed:', err.message);
		return text;
	}
}

// process incoming query - detect language and translate to english if needed
export async function processQueryLanguage(query) {
	const lang = await detectLanguage(query);

	if (lang === 'en') {
		return { detectedLang: 'en', englishQuery: query };
	}

	const englishQuery = await translateText(query, lang, 'en');
	return { detectedLang: lang, englishQuery };
}

// translate answer back to user's language
export async function translateAnswer(answer, targetLang) {
	if (targetLang === 'en') return answer;
	return translateText(answer, 'en', targetLang);
}
