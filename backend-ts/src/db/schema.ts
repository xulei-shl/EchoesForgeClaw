import { sqliteTable, uniqueIndex, index, integer, text, numeric, foreignKey, real } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm"

export const alembicVersion = sqliteTable("alembic_version", {
	versionNum: text("version_num", { length: 32 }).primaryKey().notNull(),
});

export const appSettings = sqliteTable("app_settings", {
	id: integer().primaryKey().notNull(),
	key: text().notNull(),
	value: text().notNull(),
	description: text().notNull(),
	updatedAt: numeric("updated_at"),
},
(table) => [
	uniqueIndex("ix_app_settings_key").on(table.key),
	index("ix_app_settings_id").on(table.id),
]);

export const llmConfigs = sqliteTable("llm_configs", {
	id: integer().primaryKey().notNull(),
	name: text().notNull(),
	kind: text().notNull(),
	apiKey: text("api_key").notNull(),
	baseUrl: text("base_url").notNull(),
	modelName: text("model_name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
},
(table) => [
	index("ix_llm_configs_id").on(table.id),
]);

export const users = sqliteTable("users", {
	id: integer().primaryKey().notNull(),
	username: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	role: text().notNull(),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
},
(table) => [
	uniqueIndex("ix_users_username").on(table.username),
	index("ix_users_id").on(table.id),
]);

export const favorites = sqliteTable("favorites", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull().references(() => users.id),
	generationId: integer("generation_id").notNull().references(() => generations.id),
	createdAt: numeric("created_at"),
},
(table) => [
	index("ix_favorites_user_id").on(table.userId),
	index("ix_favorites_id").on(table.id),
	index("ix_favorites_generation_id").on(table.generationId),
]);

export const publicShares = sqliteTable("public_shares", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull().references(() => users.id),
	generationId: integer("generation_id").notNull().references(() => generations.id),
	createdAt: numeric("created_at"),
},
(table) => [
	index("ix_public_shares_user_id").on(table.userId),
	index("ix_public_shares_id").on(table.id),
	uniqueIndex("ix_public_shares_generation_id").on(table.generationId),
]);

export const fastclawAgentConfigs = sqliteTable("fastclaw_agent_configs", {
	id: integer().primaryKey().notNull(),
	name: text().notNull(),
	baseUrl: text("base_url").notNull(),
	apiKey: text("api_key").notNull(),
	agentId: text("agent_id").notNull(),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
	agentName: text("agent_name"),
},
(table) => [
	index("ix_fastclaw_agent_configs_id").on(table.id),
]);

export const promptTemplates = sqliteTable("prompt_templates", {
	id: integer().primaryKey().notNull(),
	key: text(),
	name: text().notNull(),
	nodeType: text("node_type").notNull(),
	content: text().notNull(),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
},
(table) => [
	uniqueIndex("ix_prompt_templates_key").on(table.key),
	index("ix_prompt_templates_id").on(table.id),
	index("ix_prompt_templates_node_type").on(table.nodeType),
]);

export const bookCache = sqliteTable("book_cache", {
	id: integer().primaryKey().notNull(),
	isbn: text().notNull(),
	title: text().default("").notNull(),
	subtitle: text().default("").notNull(),
	originalTitle: text("original_title").default("").notNull(),
	author: text().default("").notNull(),
	translator: text().default("").notNull(),
	publisher: text().default("").notNull(),
	producer: text().default("").notNull(),
	pubYear: text("pub_year").default("").notNull(),
	pages: text().default("").notNull(),
	price: text().default("").notNull(),
	binding: text().default("").notNull(),
	series: text().default("").notNull(),
	seriesLink: text("series_link").default("").notNull(),
	rating: real().default(0).notNull(),
	ratingCount: integer("rating_count").default(0).notNull(),
	coverImage: text("cover_image").default("").notNull(),
	coverImageLocal: text("cover_image_local").default("").notNull(),
	summary: text().default("").notNull(),
	authorIntro: text("author_intro").default("").notNull(),
	catalog: text().default("").notNull(),
	url: text().default("").notNull(),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
},
(table) => [
	index("ix_book_cache_id").on(table.id),
	uniqueIndex("ix_book_cache_isbn").on(table.isbn),
]);

export const promptMetadata = sqliteTable("prompt_metadata", {
	promptId: text("prompt_id", { length: 64 }).primaryKey().notNull(),
	previewImage: text("preview_image", { length: 512 }).default("").notNull(),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
});

export const generations = sqliteTable("generations", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull().references(() => users.id),
	nodeType: text("node_type").notNull(),
	name: text().notNull(),
	stageResults: numeric("stage_results"),
	resultUrl: text("result_url"),
	status: text(),
	createdAt: numeric("created_at"),
},
(table) => [
	index("ix_generations_node_type").on(table.nodeType),
	index("ix_generations_id").on(table.id),
	index("ix_generations_name").on(table.name),
	index("ix_generations_user_id").on(table.userId),
]);

export const skillAgentConfigs = sqliteTable("skill_agent_configs", {
	id: integer().primaryKey().notNull(),
	name: text().notNull(),
	baseUrl: text("base_url").notNull(),
	apiKey: text("api_key").notNull(),
	modelName: text("model_name").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
	llmConfigId: integer("llm_config_id"),
	promptId: integer("prompt_id"),
	imageLlmConfigId: integer("image_llm_config_id"),
},
(table) => [
	index("ix_skill_agent_configs_id").on(table.id),
]);

export const nodeConfigs = sqliteTable("node_configs", {
	id: integer().primaryKey().notNull(),
	nodeType: text("node_type").notNull(),
	name: text().notNull(),
	llmConfigId: integer("llm_config_id").references(() => llmConfigs.id),
	promptId: integer("prompt_id").references(() => promptTemplates.id),
	agentConfigId: integer("agent_config_id").references(() => fastclawAgentConfigs.id),
	isActive: integer("is_active", { mode: "boolean" }),
	createdAt: numeric("created_at"),
	updatedAt: numeric("updated_at"),
	group: text(),
	groupOrder: integer("group_order").default(0).notNull(),
	skillAgentConfigId: integer("skill_agent_config_id").references(() => skillAgentConfigs.id),
},
(table) => [
	index("ix_node_configs_node_type").on(table.nodeType),
	index("ix_node_configs_id").on(table.id),
]);

export const userAnnotations = sqliteTable(
	"user_annotations",
	{
		id: integer().primaryKey().notNull(),
		userId: integer("user_id").notNull().references(() => users.id),
		resourceType: text("resource_type", { length: 32 }).notNull(),
		resourceId: text("resource_id", { length: 128 }).notNull(),
		rating: integer().default(0).notNull(),
		note: text().default("").notNull(),
		createdAt: numeric("created_at"),
		updatedAt: numeric("updated_at"),
	},
	(table) => [
		uniqueIndex("ix_user_annotations_unique").on(table.userId, table.resourceType, table.resourceId),
		index("ix_user_annotations_user_type").on(table.userId, table.resourceType),
	]
);


