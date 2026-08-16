import { relations } from "drizzle-orm/relations";
import { users, favorites, generations, publicShares, promptTemplates, nodeConfigs, fastclawAgentConfigs, llmConfigs, skillAgentConfigs } from "./schema.js";

export const favoritesRelations = relations(favorites, ({one}) => ({
	user: one(users, {
		fields: [favorites.userId],
		references: [users.id]
	}),
	generation: one(generations, {
		fields: [favorites.generationId],
		references: [generations.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	favorites: many(favorites),
	publicShares: many(publicShares),
	generations: many(generations),
}));

export const generationsRelations = relations(generations, ({one, many}) => ({
	favorites: many(favorites),
	publicShares: many(publicShares),
	user: one(users, {
		fields: [generations.userId],
		references: [users.id]
	}),
}));

export const publicSharesRelations = relations(publicShares, ({one}) => ({
	user: one(users, {
		fields: [publicShares.userId],
		references: [users.id]
	}),
	generation: one(generations, {
		fields: [publicShares.generationId],
		references: [generations.id]
	}),
}));

export const nodeConfigsRelations = relations(nodeConfigs, ({one}) => ({
	promptTemplate: one(promptTemplates, {
		fields: [nodeConfigs.promptId],
		references: [promptTemplates.id]
	}),
	fastclawAgentConfig: one(fastclawAgentConfigs, {
		fields: [nodeConfigs.agentConfigId],
		references: [fastclawAgentConfigs.id]
	}),
	llmConfig: one(llmConfigs, {
		fields: [nodeConfigs.llmConfigId],
		references: [llmConfigs.id]
	}),
	skillAgentConfig: one(skillAgentConfigs, {
		fields: [nodeConfigs.skillAgentConfigId],
		references: [skillAgentConfigs.id]
	}),
}));

export const promptTemplatesRelations = relations(promptTemplates, ({many}) => ({
	nodeConfigs: many(nodeConfigs),
}));

export const fastclawAgentConfigsRelations = relations(fastclawAgentConfigs, ({many}) => ({
	nodeConfigs: many(nodeConfigs),
}));

export const llmConfigsRelations = relations(llmConfigs, ({many}) => ({
	nodeConfigs: many(nodeConfigs),
}));

export const skillAgentConfigsRelations = relations(skillAgentConfigs, ({many}) => ({
	nodeConfigs: many(nodeConfigs),
}));