import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

let aiClient;

function resolveProvider() {
	const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
	if (provider === 'vertex' || provider === 'gemini') {
		return provider;
	}

	return process.env.GOOGLE_GENAI_USE_VERTEXAI ? 'vertex' : 'gemini';
}

export function getAiProvider() {
	return resolveProvider();
}

export function getAiClient() {
	if (aiClient) {
		return aiClient;
	}

	if (resolveProvider() === 'vertex') {
		const project = process.env.GOOGLE_CLOUD_PROJECT;
		const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

		if (!project) {
			throw new Error('GOOGLE_CLOUD_PROJECT is required when AI_PROVIDER=vertex.');
		}

		aiClient = new GoogleGenAI({
			vertexai: true,
			project,
			location,
		});
		return aiClient;
	}

	const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

	if (!apiKey) {
		throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required when AI_PROVIDER=gemini.');
	}

	aiClient = new GoogleGenAI({
		vertexai: false,
		apiKey,
	});

	return aiClient;
}