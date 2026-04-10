import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";

const VkTransportSchema = z.literal("long-poll");
const VkDmPolicySchema = z.enum(["open", "allowlist", "pairing", "disabled"]);
const VkGroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);

const VkCallbackSchema = z
  .object({
    path: z.string().optional(),
    secret: z.string().optional(),
    confirmationCode: z.string().optional(),
  })
  .strict();

const VkGroupConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
  })
  .strict();

const VkBaseConfigSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  groupId: z.number().int().positive().optional(),
  accessToken: z.string().optional(),
  tokenFile: z.string().optional(),
  transport: VkTransportSchema.optional().default("long-poll"),
  apiVersion: z.string().optional(),
  // Compatibility-only input. Active delivery uses long poll only.
  callback: VkCallbackSchema.optional(),
  dmPolicy: VkDmPolicySchema.optional().default("pairing"),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupPolicy: VkGroupPolicySchema.optional().default("disabled"),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groups: z.record(z.string(), VkGroupConfigSchema.optional()).optional(),
});

const VkAccountConfigSchema = VkBaseConfigSchema.strict();

export const VkConfigSchema = VkBaseConfigSchema.extend({
  accounts: z.record(z.string(), VkAccountConfigSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const VkChannelConfigSchema = buildChannelConfigSchema(VkConfigSchema);

export type VkConfigSchemaType = z.infer<typeof VkConfigSchema>;
